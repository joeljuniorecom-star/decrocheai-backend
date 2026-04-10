const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function logMissedCall({ twilio_number, caller_number, summary, call_sid }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/missed_calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      twilio_number,
      caller_number,
      type: 'missed_call',
      summary,
      call_sid
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase REST error ${response.status}: ${error}`);
  }

  console.log('[SUPABASE] Insert OK via REST');
  return true;
}

async function getRecentCalls(limit = 20) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/missed_calls?order=created_at.desc&limit=${limit}`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase REST error ${response.status}: ${error}`);
  }

  return response.json();
}

module.exports = { logMissedCall, getRecentCalls };
