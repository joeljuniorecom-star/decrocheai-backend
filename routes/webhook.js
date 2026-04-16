const express = require("express");
const router = express.Router();

const { sendSms, validateSignature } = require("../services/twilio");
const { generateResponse } = require("../services/anthropic");
const { logMissedCall, saveMessage, isCallProcessed } = require("../services/supabase");

// CallStatus Twilio considérés comme "appel manqué"
const MISSED_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(step, message, extra = "") {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${step}] ${message}${extra ? " | " + extra : ""}`);
}

function buildFullUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}${req.originalUrl}`;
}

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

// ─── Middleware de validation de signature Twilio ────────────────────────────

function twilioSignatureCheck(req, res, next) {
  if (process.env.SKIP_TWILIO_VALIDATION === "true") {
    return next();
  }

  const signature = req.headers["x-twilio-signature"] || "";
  const url = buildFullUrl(req);
  const valid = validateSignature(url, req.body, signature);

  if (!valid) {
    log("AUTH", "Signature Twilio invalide — requête rejetée", url);
    return res.status(403).send("Forbidden");
  }
  next();
}

// ─── POST /webhook/missed-call ───────────────────────────────────────────────

router.post("/missed-call", twilioSignatureCheck, async (req, res) => {
  const { From, To, CallSid, CallStatus } = req.body;

  // Validation des champs requis
  if (!From || !To || !CallStatus) {
    log("WEBHOOK", "Payload invalide — champs manquants", JSON.stringify({ From, To, CallStatus }));
    return res.status(400).send("Bad Request");
  }

  log("WEBHOOK", `POST reçu`, `From=${From} To=${To} CallStatus=${CallStatus} CallSid=${CallSid}`);

  // ── Étape a : Vérifier le statut de l'appel ──────────────────────────────
  if (!MISSED_STATUSES.has(CallStatus)) {
    log("WEBHOOK", `Statut ignoré (${CallStatus}) — aucun traitement`);
    return res.status(200).send(TWIML_EMPTY);
  }

  // ── Déduplication persistante via Supabase (résiste aux redéploiements) ────
  if (CallSid) {
    try {
      const alreadyDone = await isCallProcessed(CallSid);
      if (alreadyDone) {
        log("WEBHOOK", `CallSid déjà traité, ignoré`, `CallSid=${CallSid}`);
        return res.status(200).send(TWIML_EMPTY);
      }
    } catch (err) {
      log("WEBHOOK", "Erreur vérif dédup Supabase (on continue)", err.message);
    }
  }

  // Répondre immédiatement à Twilio (évite le timeout de 15 s)
  res.status(200).send(TWIML_EMPTY);

  // ── Étape b : Générer la réponse via Anthropic ───────────────────────────
  let smsText;
  try {
    log("CLAUDE", "Génération du SMS via Anthropic…");
    smsText = await generateResponse(To);
    log("CLAUDE", "SMS généré", smsText);
  } catch (err) {
    log("CLAUDE", "Erreur API Anthropic", err.message);
    smsText = `Bonjour, nous avons manqué votre appel au ${To}. Un conseiller vous rappellera rapidement.`;
  }

  // ── Étape c : Envoyer le SMS à l'appelant + sauvegarder dans l'historique ─
  try {
    const sid = await sendSms(From, smsText);
    log("SMS_AI", `SMS IA envoyé à ${From}`, `sid=${sid}`);
    // Sauvegarder comme premier message de la conversation
    await saveMessage({
      caller_number: From,
      twilio_number: To,
      direction: "outbound",
      body: smsText,
      sms_sid: sid,
    }).catch((e) => log("SUPABASE", "Erreur saveMessage (non bloquant)", e.message));
  } catch (err) {
    log("SMS_AI", `Erreur envoi SMS à ${From}`, err.message);
  }

  // ── Étape d : Alerte interne ─────────────────────────────────────────────
  const dest = process.env.DESTINATION_PHONE_NUMBER;
  if (dest) {
    try {
      const alertMsg = `[DécrocheAI] Appel manqué de ${From} — SMS IA envoyé.`;
      const sid = await sendSms(dest, alertMsg);
      log("SMS_ALERT", `Alerte interne envoyée à ${dest}`, `sid=${sid}`);
    } catch (err) {
      log("SMS_ALERT", "Erreur alerte interne (non bloquant)", err.message);
    }
  } else {
    log("SMS_ALERT", "DESTINATION_PHONE_NUMBER non défini — alerte ignorée");
  }

  // ── Étape e : Logger dans Supabase ───────────────────────────────────────
  try {
    await logMissedCall({
      twilio_number: To,
      caller_number: From,
      summary: smsText,
      call_sid: CallSid,
    });
    log("SUPABASE", "Appel manqué enregistré en base");
  } catch (err) {
    log("SUPABASE", "Erreur Supabase (non bloquant)", err.message);
  }

  log("DONE", `Flux complet terminé pour ${From}`);
});

module.exports = router;
