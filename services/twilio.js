const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = process.env.TWILIO_PHONE_NUMBER;

/**
 * Envoie un SMS via Twilio
 * @param {string} to   - Numéro destinataire (format E.164)
 * @param {string} body - Corps du message
 * @returns {Promise<string>} SID du message envoyé
 */
async function sendSms(to, body) {
  const message = await client.messages.create({ from: FROM, to, body });
  return message.sid;
}

/**
 * Valide la signature Twilio d'une requête entrante.
 * @param {string} url       - URL complète de l'endpoint (avec https://)
 * @param {Object} params    - req.body (paramètres POST)
 * @param {string} signature - Valeur de l'header X-Twilio-Signature
 * @returns {boolean}
 */
function validateSignature(url, params, signature) {
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );
}

module.exports = { sendSms, validateSignature };
