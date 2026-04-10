/**
 * test-webhook.js
 * Simule un appel Twilio entrant pour tester le flow complet en local.
 *
 * Usage :
 *   node test-webhook.js              → teste en local (http://localhost:3000)
 *   node test-webhook.js prod         → teste le backend Render
 *   node test-webhook.js prod no-answer  → statut personnalisé
 */

require("dotenv").config();

const BASE_URL =
  process.argv[2] === "prod"
    ? "https://decrocheai-backend.onrender.com"
    : "http://localhost:3000";

const CALL_STATUS = process.argv[3] || "no-answer";

const payload = new URLSearchParams({
  From: "+33600000000",
  To: "+17623830615",
  CallSid: `TEST_${Date.now()}`,
  CallStatus: CALL_STATUS,
});

async function main() {
  console.log(`\n[TEST] Envoi vers ${BASE_URL}/webhook/missed-call`);
  console.log(`[TEST] Payload : ${payload.toString()}\n`);

  const res = await fetch(`${BASE_URL}/webhook/missed-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // En local avec SKIP_TWILIO_VALIDATION=true la signature n'est pas vérifiée
      "X-Twilio-Signature": "test-bypass",
    },
    body: payload.toString(),
  });

  const body = await res.text();
  console.log(`[TEST] Status HTTP : ${res.status}`);
  console.log(`[TEST] Réponse    : ${body}`);

  if (res.status === 200) {
    console.log("\n[TEST] ✓ Webhook reçu avec succès. Vérifiez les logs du serveur pour le détail du flow.");
  } else {
    console.log("\n[TEST] ✗ Le webhook a retourné une erreur.");
  }
}

main().catch((err) => {
  console.error("[TEST] Erreur fatale :", err.message);
  process.exit(1);
});
