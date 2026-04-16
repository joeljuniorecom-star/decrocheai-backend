const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── missed_calls ─────────────────────────────────────────────────────────────

async function logMissedCall({ twilio_number, caller_number, summary, call_sid }) {
  const { error } = await supabase.from("missed_calls").insert({
    twilio_number,
    caller_number,
    type: "missed_call",
    summary,
    call_sid,
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

module.exports = { logMissedCall, getRecentCalls, saveMessage, getConversationHistory, supabase };
