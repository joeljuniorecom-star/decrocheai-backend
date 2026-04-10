const express = require("express");
const router = express.Router();

const { sendSms, validateSignature } = require("../services/twilio");
const { generateResponse } = require("../services/anthropic");
const { logMissedCall } = require("../services/supabase");

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

  log("WEBHOOK", `POST reçu`, `From=${From} To=${To} CallStatus=${CallStatus} CallSid=${CallSid}`);

  // ── Étape a : Vérifier le statut de l'appel ──────────────────────────────
  if (!MISSED_STATUSES.has(CallStatus)) {
    log("WEBHOOK", `Statut ignoré (${CallStatus}) — aucun traitement`);
    return res.status(200).send(TWIML_EMPTY);
  }

  // Répondre immédiatement à Twilio (évite le timeout de 15 s)
  res.status(200).send(TWIML_EMPTY);

  // ── Étape b : Générer la réponse via Anthropic ───────────────────────────
  let smsText = null;
  try {
    log("CLAUDE", "Génération du SMS via Anthropic…");
    smsText = await generateResponse(To);
    log("CLAUDE", "SMS généré", smsText);
  } catch (err) {
    log("CLAUDE", "Erreur API Anthropic", err.message);
    // Message de repli si Claude est indisponible
    smsText = `Bonjour, nous avons manqué votre appel au ${To}. Un conseiller vous rappellera rapidement.`;
  }

  // ── Étape c : Envoyer le SMS à l'appelant ────────────────────────────────
  try {
    const sid = await sendSms(From, smsText);
    log("SMS", `SMS envoyé à ${From}`, `sid=${sid}`);
  } catch (err) {
    log("SMS", `Erreur envoi SMS à ${From}`, err.message);
  }

  // ── Étape d : Logger dans Supabase ───────────────────────────────────────
  try {
    await logMissedCall({
      twilioNumber: To,
      callerNumber: From,
      summary: smsText,
      callSid: CallSid,
    });
    log("SUPABASE", "Appel manqué enregistré en base");
  } catch (err) {
    log("SUPABASE", "Erreur Supabase (non bloquant)", err.message);
  }

  log("DONE", `Flux complet terminé pour ${From}`);
});

module.exports = router;
