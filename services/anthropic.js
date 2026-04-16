const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Personnalité de Lia — modifier selon les besoins du client
const LIA_SYSTEM_PROMPT = `Tu es Lia, l'assistante virtuelle professionnelle et chaleureuse de cette entreprise.
Tu réponds aux SMS des clients en français.
Ton rôle : accueillir les clients qui ont appelé et n'ont pas eu de réponse, recueillir l'objet de leur appel, et leur indiquer qu'un conseiller les rappellera.
Règles absolues :
- Sois concise et chaleureuse
- Chaque réponse doit faire STRICTEMENT moins de 160 caractères (espaces inclus)
- Ne promets jamais une heure précise de rappel
- Si le client indique son besoin, confirme que tu l'as noté et rassure-le
- Réponds UNIQUEMENT avec le texte du SMS, sans guillemets ni explication`;

/**
 * Génère le SMS initial pour un appel manqué (une seule fois, sans historique).
 */
async function generateResponse(twilioNumber) {
  const prompt =
    `Rédige un SMS professionnel et chaleureux en français pour informer un client que son appel au numéro ${twilioNumber} a été manqué. ` +
    `Le message doit : 1) mentionner le numéro appelé, 2) assurer un rappel rapide, 3) inviter le client à indiquer l'objet de son appel. ` +
    `CONTRAINTE ABSOLUE : strictement moins de 160 caractères. Réponds uniquement avec le texte du SMS.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{ role: "user", content: prompt }],
  });

  let text = response.content[0].text.trim();
  if (text.length > 160) text = text.slice(0, 157) + "...";
  return text;
}

/**
 * Génère une réponse conversationnelle de Lia avec l'historique SMS.
 *
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @param {string} twilioNumber
 * @returns {Promise<string>} Texte du SMS (≤ 160 caractères)
 */
async function generateConversationReply(history, twilioNumber) {
  // Convertir l'historique en format messages Claude
  const messages = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body,
  }));

  // S'assurer que le dernier message est bien de l'utilisateur
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new Error("Le dernier message doit être du client (inbound)");
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    system: LIA_SYSTEM_PROMPT + `\nNuméro de l'entreprise : ${twilioNumber}`,
    messages,
  });

  let text = response.content[0].text.trim();
  if (text.length > 160) text = text.slice(0, 157) + "...";
  return text;
}

module.exports = { generateResponse, generateConversationReply };
