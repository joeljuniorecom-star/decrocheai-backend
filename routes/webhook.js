const express = require("express");
const router = express.Router();

const { sendSms, validateSignature } = require("../services/twilio");
const { generateResponse } = require("../services/anthropic");
const { logMissedCall } = require("../services/supabase");

const DESTINATION = process.env.DESTINATION_PHONE_NUMBER;

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(step, message, extra = "") {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${step}] ${message}${extra ? " | " + extra : ""}`);
}

function buildFullUrl(req) {
  // Sur Railway / derrière un proxy, on utilise x-forwarded-proto
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}${req.originalUrl}`;
}

// ─── Middleware de validation de signature Twilio ────────────────────────────

function twilioSignatureCheck(req, res, next) {
  // En développement local (sans ngrok HTTPS) on peut désactiver la vérif
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
  // Twilio attend toujours un 200 rapidement
  res.status(200).send("<?xml version='1.0' encoding='UTF-8'?><Response/>");

  const { From, To, Body, CallSid, CallStatus } = req.body;
  const callerMessage = Body || "";

  log("WEBHOOK", `Appel manqué reçu`, `From=${From} To=${To} CallStatus=${CallStatus} CallSid=${CallSid}`);

  // ── Étape 1 : SMS de confirmation immédiat à l'appelant ──────────────────
  try {
    const sid = await sendSms(
      From,
      "Bonjour, nous avons bien reçu votre appel. Notre IA analyse votre demande et vous répond dans quelques instants."
    );
    log("SMS_CONFIRM", `SMS de confirmation envoyé`, `sid=${sid}`);
  } catch (err) {
    log("SMS_CONFIRM", `Erreur envoi SMS confirmation`, err.message);
  }

  // ── Étape 2 : Génération de la réponse Claude ────────────────────────────
  let aiResponse = null;
  try {
    log("CLAUDE", "Appel à l'API Anthropic…");
    aiResponse = await generateResponse(callerMessage);
    log("CLAUDE", "Réponse reçue", aiResponse.slice(0, 80) + "…");
  } catch (err) {
    log("CLAUDE", "Erreur API Anthropic", err.message);
    aiResponse = null;
  }

  // ── Étape 3 : SMS de réponse IA à l'appelant ────────────────────────────
  if (aiResponse) {
    try {
      const sid = await sendSms(From, aiResponse);
      log("SMS_AI", `SMS réponse IA envoyé`, `sid=${sid}`);
    } catch (err) {
      log("SMS_AI", "Erreur envoi SMS réponse IA", err.message);
    }
  }

  // ── Étape 4 : Alerte interne ─────────────────────────────────────────────
  try {
    const alertBody =
      `📱 Appel manqué : ${From}\n` +
      `Client : ${callerMessage || "(pas de message)"}\n` +
      `Réponse IA : ${aiResponse || "Réponse IA indisponible"}`;

    const sid = await sendSms(DESTINATION, alertBody);
    log("SMS_ALERT", `Alerte interne envoyée`, `sid=${sid}`);
  } catch (err) {
    log("SMS_ALERT", "Erreur envoi alerte interne", err.message);
  }

  // ── Étape 5 : Log Supabase ───────────────────────────────────────────────
  try {
    await logMissedCall({
      twilioNumber: To,
      callerNumber: From,
      summary: aiResponse || "Réponse IA indisponible",
      callSid: CallSid,
    });
    log("SUPABASE", "Appel manqué enregistré");
  } catch (err) {
    log("SUPABASE", "Erreur Supabase (non bloquant)", err.message);
  }

  log("DONE", `Flux complet terminé pour ${From}`);
});

module.exports = router;
