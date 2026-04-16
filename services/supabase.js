const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Enregistre un appel manqué dans la table missed_calls.
 */
async function logMissedCall({ twilio_number, caller_number, summary, call_sid }) {
  const { error } = await supabase.from("missed_calls").insert({
    twilio_number,
    caller_number,
    type: "missed_call",
    summary,
    call_sid,
  });
  if (error) throw new Error(error.message);
  console.log("[SUPABASE] Insert OK");
  return true;
}

/**
 * Récupère les N derniers appels manqués.
 */
async function getRecentCalls(limit = 20) {
  const { data, error } = await supabase
    .from("missed_calls")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { logMissedCall, getRecentCalls, supabase };
