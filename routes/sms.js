const express = require("express");
const router = express.Router();

const { sendSms, validateSignature } = require("../services/twilio");
const { generateConversationReply } = require("../services/anthropic");
const { saveMessage, getConversationHistory, getClientByTwilioNumber } = require("../services/supabase");

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
  if (process.env.SKIP_TWILIO_VALIDATION === "true") return next();

  const signature = req.headers["x-twilio-signature"] || "";
  const url = buildFullUrl(req);

  const twilio = require("twilio");
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );

  if (!valid) {
    log("AUTH", "Signature Twilio invalide — SMS rejeté", url);
    return res.status(403).send("Forbidden");
  }
  next();
}

// ─── POST /webhook/incoming-sms ──────────────────────────────────────────────
// Twilio appelle ce webhook à chaque SMS entrant sur le numéro DécrocheAI

router.post("/incoming-sms", twilioSignatureCheck, async (req, res) => {
  const { From, To, Body, MessageSid } = req.body;

  if (!From || !To || !Body) {
    log("SMS_IN", "Payload invalide — champs manquants");
    return res.status(400).send("Bad Request");
  }

  log("SMS_IN", `SMS reçu de ${From}`, `Body="${Body.slice(0, 50)}..."`);

  // Répondre immédiatement à Twilio
  res.status(200).send(TWIML_EMPTY);

  // ── Étape a : Sauvegarder le message entrant ──────────────────────────────
  try {
    await saveMessage({
      caller_number: From,
      twilio_number: To,
      direction: "inbound",
      body: Body,
      sms_sid: MessageSid,
    });
  } catch (err) {
    log("SMS_IN", "Erreur sauvegarde inbound (non bloquant)", err.message);
  }

  // ── Étape b : Identifier le client et son historique ─────────────────────
  let clientPrefs = null;
  try {
    const client = await getClientByTwilioNumber(To);
    if (client) clientPrefs = client.prefs;
  } catch (err) {
    log("ROUTING", "Erreur lookup client (non bloquant)", err.message);
  }

  let history = [];
  try {
    history = await getConversationHistory(From, To, 10);
    log("CONV", `Historique récupéré`, `${history.length} messages`);
  } catch (err) {
    log("CONV", "Erreur historique (non bloquant)", err.message);
    // Fallback : utiliser juste le message entrant
    history = [{ direction: "inbound", body: Body }];
  }

  // ── Étape c : Générer la réponse de Lia ───────────────────────────────────
  let reply;
  try {
    log("LIA", "Génération de la réponse via Anthropic…");
    reply = await generateConversationReply(history, To, clientPrefs);
    log("LIA", "Réponse générée", reply);
  } catch (err) {
    log("LIA", "Erreur Anthropic", err.message);
    reply = "Merci pour votre message. Un conseiller vous recontactera très prochainement.";
  }

  // ── Étape d : Envoyer la réponse de Lia ───────────────────────────────────
  let outboundSid;
  try {
    outboundSid = await sendSms(From, reply);
    log("LIA", `Réponse envoyée à ${From}`, `sid=${outboundSid}`);
  } catch (err) {
    log("LIA", `Erreur envoi réponse à ${From}`, err.message);
    return;
  }

  // ── Étape e : Sauvegarder la réponse sortante ─────────────────────────────
  try {
    await saveMessage({
      caller_number: From,
      twilio_number: To,
      direction: "outbound",
      body: reply,
      sms_sid: outboundSid,
    });
  } catch (err) {
    log("LIA", "Erreur sauvegarde outbound (non bloquant)", err.message);
  }

  log("DONE", `Échange complet terminé pour ${From}`);
});

module.exports = router;
