const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Génère un SMS professionnel en français pour un appel manqué.
 * La réponse est volontairement limitée à 160 caractères (1 SMS).
 *
 * @param {string} twilioNumber - Numéro Twilio qui a reçu l'appel (ex: +17623830615)
 * @returns {Promise<string>} Texte du SMS (≤ 160 caractères)
 */
async function generateResponse(twilioNumber) {
  const prompt =
    `Rédige un SMS professionnel et chaleureux en français pour informer un client que son appel au numéro ${twilioNumber} a été manqué. ` +
    `Le message doit : 1) mentionner le numéro appelé, 2) assurer un rappel rapide par un conseiller, 3) inviter le client à indiquer l'objet de son appel. ` +
    `CONTRAINTE ABSOLUE : le message doit faire strictement moins de 160 caractères (espaces inclus). Réponds uniquement avec le texte du SMS, sans guillemets ni explication.`;

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 100,
    messages: [{ role: "user", content: prompt }],
  });

  let text = response.content[0].text.trim();

  // Sécurité : tronquer si Claude dépasse quand même la limite
  if (text.length > 160) {
    text = text.slice(0, 157) + "...";
  }

  return text;
}

module.exports = { generateResponse };
