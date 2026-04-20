# AUDIT.md — DécrocheAI Backend
> Généré le 2026-04-20 — Phase 1 : analyse uniquement, aucun code modifié.

---

## 1. Inventaire des fichiers

| Fichier | Rôle |
|---|---|
| `server.js` | Point d'entrée Express : rate limiting, API key auth, montage des routes |
| `routes/webhook.js` | `POST /webhook/missed-call` — webhook Twilio appel manqué → Claude → SMS |
| `routes/sms.js` | `POST /webhook/incoming-sms` — webhook Twilio SMS entrant → réponse conversationnelle Claude |
| `services/twilio.js` | Client Twilio : `sendSms()`, `validateSignature()` |
| `services/anthropic.js` | Client Claude : `generateResponse()` (SMS initial), `generateConversationReply()` (conversation) |
| `services/supabase.js` | Client Supabase : `logMissedCall()`, `saveMessage()`, `getConversationHistory()`, `isCallProcessed()` |
| `migrations/create_missed_calls.sql` | Migration table `missed_calls` avec RLS |
| `migrations/create_messages.sql` | Migration table `messages` (historique SMS) avec RLS |
| `render.yaml` | Config déploiement Render (plan free, node server.js) |
| `Dockerfile` | Image Docker (non utilisé en prod Render native) |
| `test-webhook.js` | Script de test manuel du webhook en local ou prod |
| `.env` | Variables d'environnement réelles (renseignées) |
| `.env.example` | Template des variables d'environnement |
| `README.md` | Documentation installation + déploiement |

> **Important** : ce dépôt est **backend uniquement**. Le frontend est un projet Lovable séparé (decrocheai.online). Aucun code frontend n'est présent ici.

---

## 2. Analyse des éléments critiques

### 2.1 Auth Supabase
**❌ ABSENT**

Il n'y a **aucune authentification utilisateur** dans ce backend. Le backend utilise uniquement la `SUPABASE_SERVICE_ROLE_KEY` pour écrire en base via le service role. Il n'y a pas de concept d'utilisateur connecté, de session, ni de profil.

La table `profiles` n'existe pas. Les migrations existantes ne créent que `missed_calls` et `messages`.

### 2.2 Paiements Stripe — Frontend
**❌ ABSENT**

Aucune dépendance `stripe` dans `package.json`. Zéro fichier lié à Stripe. Aucun endpoint `/api/stripe/*`.

### 2.3 Paiements Stripe — Backend / Webhooks
**❌ ABSENT**

Même constat : aucun webhook `checkout.session.completed`, aucune logique de mise à jour de `subscription_status`.

### 2.4 Accès au dashboard (gating)
**❌ ABSENT**

Pas de `profiles` table, pas de colonne `subscription_status`, pas de middleware de vérification d'abonnement. N'importe qui peut appeler les endpoints existants sans authentification (sauf `GET /calls` qui est protégé par une API key statique interne, pas par un compte utilisateur).

### 2.5 Webhooks Twilio
**✅ PRÉSENT ET FONCTIONNEL**

Deux webhooks sont implémentés et bien construits :

- `POST /webhook/missed-call` (routes/webhook.js) :
  - Validation de signature Twilio ✅
  - Déduplication par `CallSid` ✅
  - Réponse HTTP 200 immédiate avant traitement asynchrone ✅ (timeout Twilio respecté)
  - Génération SMS via Claude ✅
  - Sauvegarde dans Supabase ✅
  - Alerte interne SMS ✅

- `POST /webhook/incoming-sms` (routes/sms.js) :
  - Validation de signature Twilio ✅
  - Réponse 200 immédiate ✅
  - Historique de conversation ✅
  - Réponse conversationnelle Claude ✅

### 2.6 Fake data / données de démo
**N/A** (backend uniquement)

Il n'y a pas de données de démo dans ce backend. Les fake data mentionnées dans le brief ("Fuite d'eau rue des Fleurs") sont dans le frontend Lovable, hors de ce repo.

### 2.7 Emails (Resend)
**❌ ABSENT**

La dépendance `resend` n'est pas dans `package.json`. Aucun service email. Aucune notification admin à la soumission d'onboarding, aucun email de confirmation client.

### 2.8 Formulaire d'onboarding
**❌ ABSENT**

Pas de route `/onboarding`, pas de tables `companies`, `owners`, `ai_preferences`. Pas d'upload vers Supabase Storage.

### 2.9 Personnalisation par client (AI preferences)
**⚠️ PARTIELLEMENT PRÉSENT — BUG CRITIQUE**

Le code actuel appelle `generateResponse(To)` où `To` est le numéro Twilio appelé. Mais il **n'y a aucune logique pour associer un numéro Twilio à un client** et récupérer ses préférences IA. Tous les clients recevraient le même prompt générique. La table `ai_preferences` n'existe pas.

---

## 3. Note — Format de la clé Supabase

~~La `SUPABASE_SERVICE_ROLE_KEY` commençant par `sb_secret_` était initialement suspecte.~~

**Corrigé via MCP** : le projet Supabase utilise le nouveau format de clés 2025 (`sb_secret_...`) en parallèle des clés JWT classiques. Le format `sb_secret_[REDACTED]` dans `.env` est **valide** — confirmé par la présence de 3 lignes réelles dans `missed_calls` (les écritures fonctionnent). Aucune action requise.

---

## 4. Variables d'environnement

### Présentes dans `.env`

| Variable | Statut | Remarque |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | ✅ | Format AC... correct |
| `TWILIO_AUTH_TOKEN` | ✅ | Présent |
| `TWILIO_PHONE_NUMBER` | ⚠️ | `+17623830615` est un numéro **US**, or le produit cible des artisans **français**. Twilio FR nécessite un numéro FR. |
| `DESTINATION_PHONE_NUMBER` | ✅ | Numéro admin interne |
| `SUPABASE_URL` | ✅ | Présent |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ | Format suspect (`sb_secret_`), voir §3 |
| `ANTHROPIC_API_KEY` | ✅ | Présent |
| `API_KEY` | ✅ | Présent |
| `PORT` | ✅ | 3000 |

### Manquantes (à créer pour la Phase 2)

| Variable | Pour quoi | Priorité |
|---|---|---|
| `STRIPE_SECRET_KEY` | Créer les sessions de paiement | 🔴 Critique |
| `STRIPE_WEBHOOK_SECRET` | Vérifier la signature des webhooks Stripe | 🔴 Critique |
| `STRIPE_PRICE_ID` | ID du prix 399€/an dans Stripe | 🔴 Critique |
| `RESEND_API_KEY` | Envoi des emails (notification admin + confirmation client) | 🔴 Critique |
| `ADMIN_EMAIL` | Email de l'opérateur pour les notifications | 🔴 Critique |
| `SUPABASE_ANON_KEY` | Authentification côté frontend (Lovable) | 🟡 Nécessaire |
| `FRONTEND_URL` | URL du frontend (pour CORS + redirections Stripe) | 🟡 Nécessaire |

---

## 5. Résumé des statuts

| Composant | Statut | Détail |
|---|---|---|
| Webhook Twilio appel manqué | ✅ Fonctionnel | Bien implémenté |
| Webhook Twilio SMS entrant | ✅ Fonctionnel | Bien implémenté |
| Génération SMS via Claude | ✅ Fonctionnel | claude-haiku-4-5 |
| Validation signature Twilio | ✅ Fonctionnel | |
| Rate limiting | ✅ Fonctionnel | |
| Déduplication appels | ✅ Fonctionnel | Via CallSid |
| Timeout Twilio (<15s) | ✅ Respecté | 200 immédiat, async en arrière-plan |
| Sauvegarde Supabase | ⚠️ À vérifier | Clé suspecte (voir §3) |
| Auth utilisateur / sessions | ❌ Absent | Nécessaire pour Phase 2 |
| Paiement Stripe (frontend) | ❌ Absent | Dans Lovable (hors repo) |
| Paiement Stripe (webhook backend) | ❌ Absent | À créer |
| Gating dashboard / subscription_status | ❌ Absent | Table `profiles` manquante |
| Formulaire onboarding | ❌ Absent | Routes + tables manquantes |
| Emails (Resend) | ❌ Absent | Dépendance manquante |
| Personnalisation IA par client | ❌ Absent | Table `ai_preferences` manquante |
| Numéro FR Twilio | ❌ Absent | Numéro actuel = US (+1) |
| Upload documents (Storage) | ❌ Absent | Bucket + migrations manquants |

---

## 6. Ce que la Phase 2 devra construire

Dans ce repo backend, voici les ajouts nécessaires :

1. **Stripe** : dépendance + `POST /api/stripe/create-checkout-session` + `POST /api/webhooks/stripe`
2. **Tables Supabase** : `profiles` (avec `subscription_status`, `onboarding_status`), `companies`, `owners`, `ai_preferences` — migrations SQL à écrire
3. **Resend** : dépendance + service email (notification admin + confirmation client)
4. **Routes onboarding** : `POST /api/onboarding/submit` + upload docs vers Supabase Storage
5. **Correction clé Supabase** : vérifier et corriger la `SUPABASE_SERVICE_ROLE_KEY`
6. **Personnalisation IA** : modifier `generateResponse()` pour chercher les préférences du client selon le numéro `To`
7. **Numéro FR** : documenter la procédure d'acquisition d'un numéro Twilio FR

> Le frontend Lovable (gating dashboard, formulaire onboarding côté UI, écran d'activation) est hors de ce repo — il devra être modifié séparément dans le projet Lovable.

---

*Fin de l'audit Phase 1. En attente de validation avant de démarrer la Phase 2.*
