const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Insère un log d'appel manqué dans la table `missed_calls`.
 *
 * @param {Object} data
 * @param {string} data.twilioNumber  - Numéro Twilio appelé (To)
 * @param {string} data.callerNumber  - Numéro de l'appelant (From)
 * @param {string} data.summary       - SMS généré par Claude
 * @param {string} data.callSid       - Identifiant unique de l'appel Twilio
 */
async function logMissedCall({ twilioNumber, callerNumber, summary, callSid }) {
  const { error } = await supabase.from("missed_calls").insert({
    twilio_number: twilioNumber,
    caller_number: callerNumber,
    type: "missed_call",
    summary: summary,
    call_sid: callSid,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`[Supabase] Erreur insert missed_calls :`, error.message);
    throw new Error(error.message);
  }
}

/**
 * Retourne les N derniers appels manqués triés par date décroissante.
 *
 * @param {number} limit - Nombre maximum de résultats (défaut : 20)
 * @returns {Promise<Array>}
 */
async function getRecentCalls(limit = 20) {
  const { data, error } = await supabase
    .from("missed_calls")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Supabase] Erreur select missed_calls :`, error.message);
    throw new Error(error.message);
  }

  return data || [];
}

module.exports = { logMissedCall, getRecentCalls };
