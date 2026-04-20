const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── missed_calls ─────────────────────────────────────────────────────────────

async function logMissedCall({ twilio_number, caller_number, summary, call_sid, user_id = null }) {
  const { error } = await supabase.from("missed_calls").insert({
    twilio_number,
    caller_number,
    type: "missed_call",
    summary,
    call_sid,
    user_id,
  });
  if (error) throw new Error(error.message);
  console.log("[SUPABASE] missed_calls insert OK");
  return true;
}

async function getRecentCalls(limit = 20) {
  const { data, error } = await supabase
    .from("missed_calls")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

// ─── messages (conversation SMS) ─────────────────────────────────────────────

/**
 * Sauvegarde un message SMS (inbound ou outbound).
 */
async function saveMessage({ caller_number, twilio_number, direction, body, sms_sid }) {
  const { error } = await supabase.from("messages").insert({
    caller_number,
    twilio_number,
    direction,
    body,
    sms_sid: sms_sid || null,
  });
  if (error) throw new Error(error.message);
  console.log(`[SUPABASE] message ${direction} sauvegardé`);
  return true;
}

/**
 * Récupère les N derniers messages d'une conversation (ordre chronologique).
 * @returns {Array<{direction: 'inbound'|'outbound', body: string}>}
 */
async function getConversationHistory(caller_number, twilio_number, limit = 10) {
  const { data, error } = await supabase
    .from("messages")
    .select("direction, body, created_at")
    .eq("caller_number", caller_number)
    .eq("twilio_number", twilio_number)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  // Remettre en ordre chronologique pour Claude
  return (data || []).reverse();
}

/**
 * Vérifie si un CallSid a déjà été traité (anti-doublon persistant).
 * S'appuie sur la contrainte UNIQUE call_sid de missed_calls.
 * @returns {Promise<boolean>}
 */
async function isCallProcessed(call_sid) {
  const { data, error } = await supabase
    .from("missed_calls")
    .select("id")
    .eq("call_sid", call_sid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

// ─── Multi-tenant routing ──────────────────────────────────────────────────────

/**
 * Find which client owns a given Twilio number and return their AI preferences.
 * Returns null if no client has that number assigned yet.
 * @param {string} twilioNumber - E.164 format, e.g. +33XXXXXXXXX
 * @returns {Promise<{user_id: string, prefs: Object}|null>}
 */
async function getClientByTwilioNumber(twilioNumber) {
  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("user_id")
    .eq("assigned_phone_number", twilioNumber)
    .single();

  if (companyErr || !company) return null;

  const { data: prefs } = await supabase
    .from("ai_preferences")
    .select("trade, intervention_zone, tone, working_hours, custom_message")
    .eq("user_id", company.user_id)
    .single();

  return { user_id: company.user_id, prefs: prefs || null };
}

module.exports = {
  logMissedCall,
  getRecentCalls,
  saveMessage,
  getConversationHistory,
  isCallProcessed,
  getClientByTwilioNumber,
  supabase,
};
