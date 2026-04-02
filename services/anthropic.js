const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  "Tu es un assistant pour DécrocheAI. Un client a appelé et laissé un message. " +
  "Génère une réponse professionnelle et concise en français.";

/**
 * Génère une réponse IA à partir du message du client.
 * @param {string} userMessage - Transcription ou SMS laissé par l'appelant
 * @returns {Promise<string>} Texte de la réponse générée
 */
async function generateResponse(userMessage) {
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage || "(Aucun message laissé)" }],
  });

  return response.content[0].text;
}

module.exports = { generateResponse };
