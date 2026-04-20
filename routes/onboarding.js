const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabase } = require("../services/supabase");
const {
  sendAdminOnboardingNotification,
  sendClientOnboardingConfirmation,
  sendLineTestNotification,
} = require("../services/resend");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

function log(step, msg, extra = "") {
  console.log(`[${new Date().toISOString()}] [${step}] ${msg}${extra ? " | " + extra : ""}`);
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const token = auth.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = user;
  next();
}

// ── Upload helper ─────────────────────────────────────────────────────────────

async function uploadToStorage(userId, fileName, buffer, mimeType) {
  const path = `${userId}/${fileName}`;
  const { error } = await supabase.storage
    .from("onboarding-documents")
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Storage upload failed for ${fileName}: ${error.message}`);
  return path;
}

async function getSignedUrl(path) {
  const { data } = await supabase.storage
    .from("onboarding-documents")
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
  return data?.signedUrl || null;
}

// ── POST /api/onboarding/submit ───────────────────────────────────────────────
// Accepts multipart/form-data with fields from all 3 onboarding steps.
// Files: kbis_document, address_proof, id_document

router.post(
  "/submit",
  requireAuth,
  upload.fields([
    { name: "kbis_document", maxCount: 1 },
    { name: "address_proof", maxCount: 1 },
    { name: "id_document", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { body, files } = req;

    // ── Validate required fields ────────────────────────────────────────────
    const required = [
      "company_name", "siren", "legal_form",
      "address_street", "address_zip", "address_city",
      "professional_phone",
      "first_name", "last_name", "date_of_birth", "nationality",
      "trade", "tone",
    ];
    const missing = required.filter((f) => !body[f]);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    log("ONBOARDING", "Submit received", `user=${userId}`);

    // ── Upload files to Supabase Storage ────────────────────────────────────
    let kbisPath = null, addressProofPath = null, idDocumentPath = null;

    try {
      if (files.kbis_document?.[0]) {
        const f = files.kbis_document[0];
        kbisPath = await uploadToStorage(userId, `kbis_${Date.now()}_${f.originalname}`, f.buffer, f.mimetype);
      }
      if (files.address_proof?.[0]) {
        const f = files.address_proof[0];
        addressProofPath = await uploadToStorage(userId, `address_proof_${Date.now()}_${f.originalname}`, f.buffer, f.mimetype);
      }
      if (files.id_document?.[0]) {
        const f = files.id_document[0];
        idDocumentPath = await uploadToStorage(userId, `id_doc_${Date.now()}_${f.originalname}`, f.buffer, f.mimetype);
      }
    } catch (err) {
      log("ONBOARDING", "Storage upload failed", err.message);
      return res.status(500).json({ error: `File upload failed: ${err.message}` });
    }

    // ── Save company ─────────────────────────────────────────────────────────
    const { error: companyErr } = await supabase.from("companies").upsert({
      user_id: userId,
      company_name: body.company_name,
      siren: body.siren,
      legal_form: body.legal_form,
      address_street: body.address_street,
      address_zip: body.address_zip,
      address_city: body.address_city,
      address_country: "France",
      professional_phone: body.professional_phone,
      kbis_document_path: kbisPath,
      address_proof_path: addressProofPath,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (companyErr) {
      log("ONBOARDING", "DB error (companies)", companyErr.message);
      return res.status(500).json({ error: companyErr.message });
    }

    // ── Save owner ───────────────────────────────────────────────────────────
    const { error: ownerErr } = await supabase.from("owners").upsert({
      user_id: userId,
      first_name: body.first_name,
      last_name: body.last_name,
      date_of_birth: body.date_of_birth,
      nationality: body.nationality,
      id_document_path: idDocumentPath,
    }, { onConflict: "user_id" });

    if (ownerErr) {
      log("ONBOARDING", "DB error (owners)", ownerErr.message);
      return res.status(500).json({ error: ownerErr.message });
    }

    // ── Save AI preferences ───────────────────────────────────────────────────
    const { error: aiErr } = await supabase.from("ai_preferences").upsert({
      user_id: userId,
      trade: body.trade,
      intervention_zone: body.intervention_zone || null,
      tone: body.tone,
      working_hours: body.working_hours || null,
      custom_message: body.custom_message || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (aiErr) {
      log("ONBOARDING", "DB error (ai_preferences)", aiErr.message);
      return res.status(500).json({ error: aiErr.message });
    }

    // ── Update profile status ─────────────────────────────────────────────────
    await supabase.from("profiles").update({
      onboarding_status: "pending_provisioning",
      updated_at: new Date().toISOString(),
    }).eq("id", userId);

    log("ONBOARDING", "Data saved to DB", `user=${userId}`);

    // ── Generate signed URLs for admin email ──────────────────────────────────
    const documentUrls = {
      kbis: kbisPath ? await getSignedUrl(kbisPath) : null,
      addressProof: addressProofPath ? await getSignedUrl(addressProofPath) : null,
      idDocument: idDocumentPath ? await getSignedUrl(idDocumentPath) : null,
    };

    // ── Send emails (non-blocking — errors don't fail the request) ────────────
    const company = {
      company_name: body.company_name,
      siren: body.siren,
      legal_form: body.legal_form,
      address_street: body.address_street,
      address_zip: body.address_zip,
      address_city: body.address_city,
      professional_phone: body.professional_phone,
    };
    const owner = {
      first_name: body.first_name,
      last_name: body.last_name,
      date_of_birth: body.date_of_birth,
      nationality: body.nationality,
    };
    const aiPrefs = {
      trade: body.trade,
      intervention_zone: body.intervention_zone,
      tone: body.tone,
      working_hours: body.working_hours,
      custom_message: body.custom_message,
    };

    sendAdminOnboardingNotification({ user: { id: userId, email: userEmail }, company, owner, aiPrefs, documentUrls })
      .then(() => log("EMAIL", "Admin notification sent"))
      .catch((e) => log("EMAIL", "Admin notification failed (non-blocking)", e.message));

    sendClientOnboardingConfirmation({ email: userEmail, firstName: body.first_name, companyName: body.company_name })
      .then(() => log("EMAIL", "Client confirmation sent"))
      .catch((e) => log("EMAIL", "Client confirmation failed (non-blocking)", e.message));

    res.json({ success: true, onboarding_status: "pending_provisioning" });
  }
);

// ── POST /api/onboarding/test-line ────────────────────────────────────────────
// Client clicks "Tester ma ligne" — notifies admin by email.

router.post("/test-line", requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data: company } = await supabase
    .from("companies")
    .select("company_name, professional_phone, assigned_phone_number")
    .eq("user_id", userId)
    .single();

  if (!company?.assigned_phone_number) {
    return res.status(400).json({ error: "Aucun numéro assigné pour ce compte" });
  }

  sendLineTestNotification({
    email: req.user.email,
    companyName: company.company_name,
    professionalPhone: company.professional_phone,
    assignedPhone: company.assigned_phone_number,
  })
    .then(() => log("EMAIL", "Line-test notification sent", `user=${userId}`))
    .catch((e) => log("EMAIL", "Line-test notification failed", e.message));

  res.json({ success: true });
});

// ── GET /api/onboarding/status ────────────────────────────────────────────────
// Returns the user's profile + assigned number for the dashboard.

router.get("/status", requireAuth, async (req, res) => {
  const userId = req.user.id;

  const [profileResult, companyResult] = await Promise.all([
    supabase.from("profiles").select("subscription_status, onboarding_status").eq("id", userId).single(),
    supabase.from("companies").select("assigned_phone_number, company_name, professional_phone").eq("user_id", userId).single(),
  ]);

  const profile = profileResult.data;
  const company = companyResult.data;

  // Generate divert code from assigned number (+33XXXXXXXXX → **21*+33XXXXXXXXX#)
  const divertCode = company?.assigned_phone_number
    ? `**21*${company.assigned_phone_number}#`
    : null;

  res.json({
    subscription_status: profile?.subscription_status || "pending",
    onboarding_status: profile?.onboarding_status || "not_started",
    assigned_phone_number: company?.assigned_phone_number || null,
    divert_code: divertCode,
    company_name: company?.company_name || null,
  });
});

module.exports = router;
