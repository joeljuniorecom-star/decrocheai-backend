# DEPLOYMENT_READY.md — DécrocheAI : Guide de mise en production

---

## Ce qui est 100% fonctionnel (code prêt)

| Composant | Endpoint | Notes |
|---|---|---|
| Webhook appel manqué | `POST /webhook/missed-call` | Twilio → Claude → SMS, dédup, timeout OK |
| Webhook SMS entrant | `POST /webhook/incoming-sms` | Conversation Claude avec historique |
| Routing multi-tenant | automatique | Identifie le client par son numéro Twilio |
| Préférences IA | automatique | Tone, métier, zone, horaires par client |
| Paiement Stripe | `POST /api/stripe/create-checkout-session` | Embedded checkout, retourne `clientSecret` |
| Webhook Stripe | `POST /api/stripe/webhook` | Signature vérifiée, `subscription_status` mis à jour |
| Soumission onboarding | `POST /api/onboarding/submit` | Multipart, upload Supabase Storage, emails |
| Test de ligne | `POST /api/onboarding/test-line` | Email admin |
| Statut client | `GET /api/onboarding/status` | Subscription + numéro assigné + code de renvoi |
| Rate limiting | toutes les routes | 200 req/min webhooks, 60/min API |
| Auth JWT Supabase | toutes routes `/api/` | Vérification via `supabase.auth.getUser()` |

---

## Actions manuelles requises (dans cet ordre)

### Étape 1 — ✅ Migrations Supabase (exécutées via MCP le 2026-04-20)

Tables créées sur le projet `jcftwxdggxnuwhhiatsr` :
- `profiles` ✅ (avec trigger auto-création sur signup)
- `companies` ✅ (index sur `assigned_phone_number`)
- `owners` ✅
- `ai_preferences` ✅
- `missed_calls` mis à jour ✅ (colonnes `user_id`, `urgency`, `status`)
- Bucket Storage `onboarding-documents` privé ✅ (RLS configurée)

La clé `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...` est **valide** (nouveau format Supabase 2025).
La `SUPABASE_ANON_KEY` a été ajoutée dans `.env`.

### Étape 2 — Configurer Stripe

1. **Créer un produit** dans [Stripe Dashboard](https://dashboard.stripe.com) :
   - Nom : "DécrocheAI — Abonnement annuel"
   - Prix : 399 EUR / an, récurrent
   - Copier le **Price ID** (`price_xxx...`)

2. **Créer un webhook Stripe** :
   - Dashboard → Developers → Webhooks → **Add endpoint**
   - URL : `https://decrocheai-backend.onrender.com/api/stripe/webhook`
   - Événements à écouter :
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Copier le **Signing secret** (`whsec_xxx...`)

3. Renseigner dans `.env` et Render :
   ```
   STRIPE_SECRET_KEY=VOTRE_CLE_STRIPE
   STRIPE_WEBHOOK_SECRET=whsec_xxx...
   STRIPE_PRICE_ID=price_xxx...
   ```

### Étape 4 — Configurer Resend

1. Créer un compte sur [resend.com](https://resend.com)
2. Ajouter et **vérifier le domaine** `decrocheai.online` (ajouter les DNS TXT indiqués)
3. Créer une API key → copier la valeur
4. Renseigner dans `.env` et Render :
   ```
   RESEND_API_KEY=re_xxx...
   ADMIN_EMAIL=votre@email.com
   FROM_EMAIL=noreply@decrocheai.online
   ```

### Étape 5 — Acheter un numéro Twilio FR

> Le numéro actuel (`+17623830615`) est US. Pour les artisans français, il faut un numéro FR.

1. [console.twilio.com](https://console.twilio.com) → **Phone Numbers** → **Buy a number**
2. Choisir **France (+33)**, type **Local** ou **Mobile**
3. Important : activer **SMS** + **Voice** sur le numéro
4. **Configurer les webhooks du numéro** :
   - Voice → Webhook → `https://decrocheai-backend.onrender.com/webhook/missed-call` (POST)
   - Messaging → Webhook → `https://decrocheai-backend.onrender.com/webhook/incoming-sms` (POST)
5. Mettre à jour `TWILIO_PHONE_NUMBER=+33XXXXXXXXX` dans `.env` et Render

> **Note** : Twilio FR exige un **bundle réglementaire** pour les numéros français.
> Vous devrez fournir les mêmes documents que ce que le formulaire d'onboarding collecte
> (KBIS, justificatif d'adresse, CNI du gérant). Voir :
> console.twilio.com → Phone Numbers → Regulatory Compliance → Create a Bundle

### Étape 6 — Variables d'environnement sur Render

Dans Render Dashboard → votre service → **Environment** :

```
TWILIO_ACCOUNT_SID      = (valeur actuelle OK)
TWILIO_AUTH_TOKEN       = (valeur actuelle OK)
TWILIO_PHONE_NUMBER     = +33XXXXXXXXX  ← à mettre à jour
DESTINATION_PHONE_NUMBER = +33651367362 (OK)
SUPABASE_URL            = (valeur actuelle OK)
SUPABASE_SERVICE_ROLE_KEY = eyJ...      ← à corriger (voir Étape 1)
ANTHROPIC_API_KEY       = (valeur actuelle OK)
API_KEY                 = (valeur actuelle OK)
STRIPE_SECRET_KEY       = VOTRE_CLE_STRIPE
STRIPE_WEBHOOK_SECRET   = whsec_xxx...
STRIPE_PRICE_ID         = price_xxx...
RESEND_API_KEY          = re_xxx...
ADMIN_EMAIL             = votre@email.com
FROM_EMAIL              = noreply@decrocheai.online
FRONTEND_URL            = https://decrocheai.online
PORT                    = 3000
```

### Étape 7 — Configurer le frontend Lovable

Le frontend (decrocheai.online) est un projet Lovable séparé. Il doit être mis à jour pour :

1. **Page `/subscribe`** : utiliser le `clientSecret` retourné par `POST /api/stripe/create-checkout-session` pour afficher Stripe Embedded Checkout (composant `<EmbeddedCheckout>` de `@stripe/react-stripe-js`).

2. **Guard dashboard** : appeler `GET /api/onboarding/status` au chargement → rediriger vers `/subscribe` si `subscription_status !== 'active'`.

3. **Page `/onboarding`** : formulaire multi-étapes qui soumet en `multipart/form-data` vers `POST /api/onboarding/submit`.

4. **Écran d'attente** : afficher `onboarding_status === 'pending_provisioning'` avec un message d'attente.

5. **Dashboard actif** : afficher `assigned_phone_number` et `divert_code` retournés par `GET /api/onboarding/status`.

6. **Supprimer les fake data** : retirer les données hardcodées ("Fuite d'eau rue des Fleurs", etc.) et afficher uniquement les vraies données depuis Supabase.

### Étape 8 — Activer un client (provisionnement manuel)

Quand vous recevez l'email admin d'un nouveau client :

1. Acheter/assigner un numéro Twilio FR
2. Configurer les webhooks du numéro (voir Étape 5)
3. Dans Supabase SQL Editor :
   ```sql
   UPDATE companies
   SET assigned_phone_number = '+33XXXXXXXXX'
   WHERE user_id = '<user_id du client>';

   UPDATE profiles
   SET onboarding_status = 'active'
   WHERE id = '<user_id du client>';
   ```
4. Le dashboard du client se mettra à jour automatiquement.

---

## Variables d'environnement complètes

Voir `.env.example` pour la liste complète avec descriptions.

---

## Tests automatisables immédiatement

```bash
# Test 1 : webhook appel manqué (en local, SKIP_TWILIO_VALIDATION=true)
node test-webhook.js

# Test 2 : syntax check de tous les fichiers
node --check server.js routes/*.js services/*.js
```

Voir `E2E_TESTS.md` pour la checklist complète des tests manuels.
