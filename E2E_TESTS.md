# E2E_TESTS.md — DécrocheAI : Checklist de tests end-to-end
> Phase 3 — Tests manuels et automatisés à effectuer avant mise en production.

---

## Prérequis

1. Serveur démarré en local : `npm run dev`
2. Dans `.env` : `SKIP_TWILIO_VALIDATION=true` (local uniquement)
3. Ngrok actif : `ngrok http 3000` → copier l'URL HTTPS

---

## Test 1 — Webhook appel manqué (cœur du produit)

**Objectif** : simuler un appel manqué Twilio → SMS envoyé → enregistré en DB.

```bash
# En local (SKIP_TWILIO_VALIDATION=true requis)
node test-webhook.js

# Sur Render prod
node test-webhook.js prod
```

**Vérifications** :
- [ ] HTTP 200 retourné immédiatement
- [ ] Log `[CLAUDE] SMS généré` dans les logs serveur
- [ ] SMS reçu sur le numéro `From` (+33600000000 en test → vérifier Twilio Logs)
- [ ] Alerte SMS reçue sur `DESTINATION_PHONE_NUMBER`
- [ ] Row créée dans `missed_calls` sur Supabase

**Commande Supabase SQL pour vérifier** :
```sql
SELECT * FROM missed_calls ORDER BY created_at DESC LIMIT 5;
```

---

## Test 2 — Webhook SMS entrant (conversation)

**Objectif** : simuler une réponse SMS du client → Lia répond.

```bash
curl -X POST http://localhost:3000/webhook/incoming-sms \
  -d "From=%2B33600000000" \
  -d "To=%2B17623830615" \
  -d "Body=Bonjour+j%27ai+une+fuite+d%27eau" \
  -d "MessageSid=SMS_TEST_$(date +%s)"
```

**Vérifications** :
- [ ] HTTP 200 immédiat
- [ ] Log `[LIA] Réponse générée` dans les logs
- [ ] SMS réponse envoyé sur le numéro `From`
- [ ] 2 rows dans `messages` (inbound + outbound)

---

## Test 3 — Stripe : création de session de paiement

**Prérequis** : `STRIPE_SECRET_KEY` et `STRIPE_PRICE_ID` renseignés, utilisateur Supabase créé.

```bash
# Récupérer un JWT utilisateur Supabase valide (via l'app front ou curl)
TOKEN="eyJ..."

curl -X POST http://localhost:3000/api/stripe/create-checkout-session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Vérifications** :
- [ ] Réponse `{ "clientSecret": "cs_..." }`
- [ ] Session visible dans Stripe Dashboard → Payments → Checkout Sessions
- [ ] Row mise à jour dans `profiles` avec `stripe_customer_id`

---

## Test 4 — Stripe : webhook paiement réussi

**Prérequis** : `STRIPE_WEBHOOK_SECRET` renseigné, Stripe CLI installé.

```bash
# Écouter les événements Stripe en local
stripe listen --forward-to http://localhost:3000/api/stripe/webhook

# Dans un autre terminal : simuler un checkout.session.completed
stripe trigger checkout.session.completed
```

**Vérifications** :
- [ ] Log `[STRIPE_WH] subscription_status set to active`
- [ ] Dans Supabase : `SELECT subscription_status FROM profiles WHERE id='...';` → `active`

---

## Test 5 — Auth : accès refusé sans JWT

```bash
curl -X POST http://localhost:3000/api/stripe/create-checkout-session
# Attendu : 401 {"error":"Missing Bearer token"}

curl -X GET http://localhost:3000/api/onboarding/status
# Attendu : 401 {"error":"Missing Bearer token"}
```

---

## Test 6 — Onboarding : soumission du formulaire

**Prérequis** : utilisateur avec `subscription_status = 'active'`, JWT valide.

```bash
TOKEN="eyJ..."

curl -X POST http://localhost:3000/api/onboarding/submit \
  -H "Authorization: Bearer $TOKEN" \
  -F "company_name=Plomberie Dupont" \
  -F "siren=123456789" \
  -F "legal_form=auto-entrepreneur" \
  -F "address_street=12 rue des Artisans" \
  -F "address_zip=75001" \
  -F "address_city=Paris" \
  -F "professional_phone=+33612345678" \
  -F "first_name=Jean" \
  -F "last_name=Dupont" \
  -F "date_of_birth=1980-05-15" \
  -F "nationality=Française" \
  -F "trade=plombier" \
  -F "tone=chaleureux" \
  -F "intervention_zone=Paris 75001-75020" \
  -F "kbis_document=@/tmp/test.pdf"
```

**Vérifications** :
- [ ] HTTP 200 `{ "success": true, "onboarding_status": "pending_provisioning" }`
- [ ] Row dans `companies` avec les bonnes infos
- [ ] Row dans `owners`
- [ ] Row dans `ai_preferences`
- [ ] `profiles.onboarding_status = 'pending_provisioning'`
- [ ] Fichier visible dans Supabase Storage → bucket `onboarding-documents`
- [ ] Email admin reçu sur `ADMIN_EMAIL`
- [ ] Email confirmation reçu sur l'email du client

---

## Test 7 — Status endpoint

```bash
TOKEN="eyJ..."
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/onboarding/status
```

**Attendu (avant provisionnement)** :
```json
{
  "subscription_status": "active",
  "onboarding_status": "pending_provisioning",
  "assigned_phone_number": null,
  "divert_code": null,
  "company_name": "Plomberie Dupont"
}
```

**Attendu (après provisionnement admin)** :
```json
{
  "subscription_status": "active",
  "onboarding_status": "pending_provisioning",
  "assigned_phone_number": "+33XXXXXXXXX",
  "divert_code": "**21*+33XXXXXXXXX#",
  "company_name": "Plomberie Dupont"
}
```

---

## Test 8 — Test de ligne

**Prérequis** : `assigned_phone_number` renseigné en DB pour le client.

```bash
TOKEN="eyJ..."
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/onboarding/test-line
```

**Vérifications** :
- [ ] HTTP 200 `{ "success": true }`
- [ ] Email reçu sur `ADMIN_EMAIL` avec les infos du client

---

## Test 9 — Routing multi-tenant

**Objectif** : vérifier que l'IA utilise les bonnes préférences selon le numéro appelé.

1. Créer en DB :
   ```sql
   UPDATE companies SET assigned_phone_number='+33700000001' WHERE user_id='<uuid>';
   UPDATE ai_preferences SET trade='plombier', tone='chaleureux' WHERE user_id='<uuid>';
   ```

2. Simuler un appel sur ce numéro :
   ```bash
   curl -X POST http://localhost:3000/webhook/missed-call \
     -d "From=%2B33600000000" \
     -d "To=%2B33700000001" \
     -d "CallSid=TEST_MULTI_$(date +%s)" \
     -d "CallStatus=no-answer"
   ```

3. **Vérifications** :
   - [ ] Log `[ROUTING] Client identifié | user=<uuid>`
   - [ ] SMS généré avec ton chaleureux et contexte plombier
   - [ ] Row dans `missed_calls` avec le bon `user_id`

---

## Test 10 — Déduplication

Envoyer deux fois la même requête avec le même `CallSid` :

```bash
curl -X POST http://localhost:3000/webhook/missed-call \
  -d "From=%2B33600000000" \
  -d "To=%2B17623830615" \
  -d "CallSid=CA_DEDUP_TEST" \
  -d "CallStatus=no-answer"

# Renvoi immédiat
curl -X POST http://localhost:3000/webhook/missed-call \
  -d "From=%2B33600000000" \
  -d "To=%2B17623830615" \
  -d "CallSid=CA_DEDUP_TEST" \
  -d "CallStatus=no-answer"
```

**Vérification** :
- [ ] 2ème appel retourne 200 avec log `[WEBHOOK] CallSid déjà traité, ignoré`
- [ ] Une seule row dans `missed_calls` pour `call_sid = 'CA_DEDUP_TEST'`
