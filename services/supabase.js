const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Insère un log d'appel manqué dans la table `missed_calls`.
 * @param {Object} data
 * @param {string} data.twilioNumber  - Numéro Twilio appelé (To)
 * @param {string} data.callerNumber  - Numéro de l'appelant (From)
 * @param {string} data.summary       - Réponse IA générée
 * @param {string} data.callSid       - Identifiant unique de l'appel Twilio
 */
async function logMissedCall({ twilioNumber, callerNumber, summary, callSid }) {
  const { error } = await supabase.from("missed_calls").insert({
    twilio_number: twilioNumber,
    caller_number: callerNumber,
    type: "urgence",
    summary: summary,
    call_sid: callSid,
    created_at: new Date().toISOString(),
  });

  if (error) {
    // On logue l'erreur mais on ne bloque pas le flux
    console.error(`[Supabase] Erreur insert missed_calls :`, error.message);
  }
}

module.exports = { logMissedCall };
