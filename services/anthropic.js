const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tone descriptions for system prompt construction
const TONE_DESC = {
  professionnel: "professionnel et courtois",
  chaleureux: "chaleureux et bienveillant",
  direct: "direct et efficace",
};

/**
 * Build a personalized system prompt from ai_preferences.
 * @param {Object|null} prefs - Row from ai_preferences table, or null for generic
 */
function buildSystemPrompt(prefs) {
  const tone = TONE_DESC[prefs?.tone] || TONE_DESC.professionnel;
  const trade = prefs?.trade || "artisan";
  const zone = prefs?.intervention_zone ? ` intervenant dans ${prefs.intervention_zone}` : "";
  const hours = prefs?.working_hours
    ? ` Horaires d'activité : ${prefs.working_hours}.`
    : "";
  const custom = prefs?.custom_message
    ? ` Message personnalisé à intégrer si pertinent : "${prefs.custom_message}".`
    : "";

  return `Tu es Lia, l'assistante virtuelle d'un ${trade}${zone}.
Tu réponds aux SMS des clients en français, avec un ton ${tone}.
Ton rôle : accueillir les clients qui ont appelé et n'ont pas eu de réponse, recueillir l'objet de leur appel, et leur indiquer qu'un conseiller les rappellera.${hours}${custom}
Règles absolues :
- Chaque réponse doit faire STRICTEMENT moins de 160 caractères (espaces inclus)
- Ne promets jamais une heure précise de rappel
- Si le client indique son besoin, confirme que tu l'as noté et rassure-le
- Réponds UNIQUEMENT avec le texte du SMS, sans guillemets ni explication`;
}

/**
 * Génère le SMS initial pour un appel manqué (une seule fois, sans historique).
 * @param {string} twilioNumber - The DécrocheAI number that was called
 * @param {Object|null} prefs - ai_preferences row for the client, or null
 */
async function generateResponse(twilioNumber, prefs = null) {
  const tone = TONE_DESC[prefs?.tone] || TONE_DESC.professionnel;
  const trade = prefs?.trade || "artisan";

  const prompt =
    `Rédige un SMS ${tone} en français pour un ${trade}. Le client a appelé le ${twilioNumber} et n'a pas eu de réponse. ` +
    `Le message doit : 1) le remercier d'avoir appelé, 2) assurer un rappel rapide, 3) l'inviter à préciser l'objet de son appel. ` +
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
 * @param {Object|null} prefs - ai_preferences row for the client, or null
 * @returns {Promise<string>} Texte du SMS (≤ 160 caractères)
 */
async function generateConversationReply(history, twilioNumber, prefs = null) {
  const messages = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body,
  }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new Error("Le dernier message doit être du client (inbound)");
  }

  const system = buildSystemPrompt(prefs) + `\nNuméro de l'entreprise : ${twilioNumber}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    system,
    messages,
  });

  let text = response.content[0].text.trim();
  if (text.length > 160) text = text.slice(0, 157) + "...";
  return text;
}

module.exports = { generateResponse, generateConversationReply };
