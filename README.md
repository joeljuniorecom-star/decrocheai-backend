# DécrocheAI — Backend Node.js

Backend Express qui remplace le scénario Make.com pour la gestion des appels manqués.
Flux : Twilio webhook → SMS immédiat → Claude → SMS réponse IA → alerte interne → Supabase.

---

## Structure

```
decrocheai-backend/
├── server.js                  # Point d'entrée Express
├── routes/
│   └── webhook.js             # POST /webhook/missed-call
├── services/
│   ├── twilio.js              # Envoi SMS + validation signature
│   ├── anthropic.js           # Appel à claude-opus-4-6
│   └── supabase.js            # Insert dans missed_calls
├── migrations/
│   └── create_missed_calls.sql
├── render.yaml                # Config déploiement Render
├── Dockerfile
└── .env.example
```

---

## Installation locale

```bash
git clone https://github.com/joeljuniorecom-star/decrocheai-backend.git
cd decrocheai-backend
npm install
cp .env.example .env
# Remplir les valeurs dans .env
npm run dev
```

Pour exposer le serveur local à Twilio (HTTPS requis) :

```bash
ngrok http 3000
# Copier l'URL HTTPS affichée, ex : https://abc123.ngrok.io
```

> En dev local, ajouter `SKIP_TWILIO_VALIDATION=true` dans `.env` pour désactiver
> la vérification de signature Twilio.

---

## Variables d'environnement

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account SID Twilio (commence par AC) |
| `TWILIO_AUTH_TOKEN` | Auth Token Twilio |
| `TWILIO_PHONE_NUMBER` | Numéro expéditeur Twilio (`+17623830615`) |
| `DESTINATION_PHONE_NUMBER` | Numéro qui reçoit les alertes internes |
| `SUPABASE_URL` | URL de votre projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase (pas la clé anon) |
| `ANTHROPIC_API_KEY` | Clé API Anthropic |
| `PORT` | Port d'écoute (défaut : 3000) |
| `SKIP_TWILIO_VALIDATION` | Mettre `true` en dev local sans HTTPS |

---

## Déploiement sur Render

### 1. Migration Supabase (à faire en premier)

Supabase → SQL Editor → New query → coller le contenu de `migrations/create_missed_calls.sql` → **Run**.

### 2. Push sur GitHub

```bash
git clone https://github.com/joeljuniorecom-star/decrocheai-backend.git
# ou si vous avez le code en local :
cd decrocheai-backend
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/joeljuniorecom-star/decrocheai-backend.git
git push -u origin main
```

### 3. Créer le service sur Render

1. Aller sur [render.com](https://render.com) → **New +** → **Web Service**
2. **Connect a repository** → sélectionner `joeljuniorecom-star/decrocheai-backend`
3. Render détecte automatiquement `render.yaml` — les settings sont pré-remplis :
   - **Name** : `decrocheai-backend`
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : Free

> Alternativement, cliquer sur **New +** → **Blueprint** pour utiliser `render.yaml` directement.

### 4. Ajouter les variables d'environnement

Dans Render → votre service → **Environment** → **Add Environment Variable** :

```
TWILIO_ACCOUNT_SID      = ACxxxxxxxx...
TWILIO_AUTH_TOKEN       = xxxxxxxx...
TWILIO_PHONE_NUMBER     = +17623830615
DESTINATION_PHONE_NUMBER= +33651367362
SUPABASE_URL            = https://qpmixfwosisylxfuxnpx.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJxxx...
ANTHROPIC_API_KEY       = sk-ant-xxx...
PORT                    = 3000
```

Cliquer sur **Save Changes** — Render redéploie automatiquement.

### 5. Récupérer l'URL publique

Render → votre service → en haut de la page :
```
https://decrocheai-backend.onrender.com
```

### 6. Configurer le webhook Twilio

1. [console.twilio.com](https://console.twilio.com) → **Phone Numbers** → **Manage** → **Active Numbers**
2. Cliquer sur `+17623830615`
3. Section **Voice & Fax** → **A call comes in** :
   - Type : `Webhook`
   - Méthode : `HTTP POST`
   - URL : `https://decrocheai-backend.onrender.com/webhook/missed-call`
4. **Save**

> **Note Render Free** : le service s'endort après 15 min d'inactivité (cold start ~30s).
> Pour éviter ça en production, passer au plan **Starter** ($7/mois) ou utiliser un service
> de ping régulier (ex: UptimeRobot → ping `/health` toutes les 10 min).

---

## Connexion au front-end Lovable (decrocheai.online)

### Option A — Supabase directement depuis Lovable (recommandé)

Dans votre projet Lovable, configurer les variables d'environnement :

```
VITE_SUPABASE_URL=https://qpmixfwosisylxfuxnpx.supabase.co
VITE_SUPABASE_ANON_KEY=<votre clé anon Supabase>
```

Code Lovable pour afficher les appels manqués :

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Récupérer les derniers appels manqués
const { data, error } = await supabase
  .from('missed_calls')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(50)
```

Ajouter dans Supabase une policy RLS pour la lecture authentifiée :

```sql
CREATE POLICY "authenticated_read" ON public.missed_calls
  FOR SELECT
  TO authenticated
  USING (true);
```

### Option B — API REST via ce backend

Ajouter dans `routes/webhook.js` :

```js
const { supabase } = require('../services/supabase')

// GET /api/missed-calls
router.get('/api/missed-calls', async (req, res) => {
  const { data, error } = await supabase
    .from('missed_calls')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})
```

Depuis Lovable, appeler `https://decrocheai-backend.onrender.com/api/missed-calls`.

### CORS (si Lovable appelle ce backend directement)

```bash
npm install cors
```

Dans `server.js`, ajouter avant les routes :

```js
const cors = require('cors')
app.use(cors({ origin: 'https://decrocheai.online' }))
```

---

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck → `{ "status": "ok" }` |
| `POST` | `/webhook/missed-call` | Webhook Twilio appel manqué |

---

## Tester manuellement

```bash
curl -X POST https://decrocheai-backend.onrender.com/webhook/missed-call \
  -d "From=%2B33600000000" \
  -d "To=%2B17623830615" \
  -d "Body=Bonjour+je+voulais+prendre+RDV" \
  -d "CallSid=CAtest123" \
  -d "CallStatus=no-answer"
```

En local (avec `SKIP_TWILIO_VALIDATION=true`) :

```bash
curl -X POST http://localhost:3000/webhook/missed-call \
  -d "From=%2B33600000000" \
  -d "To=%2B17623830615" \
  -d "Body=Bonjour+test" \
  -d "CallSid=CAtest123" \
  -d "CallStatus=no-answer"
```

---

## Logs

Chaque étape est loggée avec timestamp et tag :

```
[2026-04-02T10:00:00.000Z] [WEBHOOK]     Appel manqué reçu | From=+336... To=+176...
[2026-04-02T10:00:00.200Z] [SMS_CONFIRM] SMS de confirmation envoyé | sid=SM...
[2026-04-02T10:00:00.400Z] [CLAUDE]      Appel à l'API Anthropic…
[2026-04-02T10:00:02.100Z] [CLAUDE]      Réponse reçue | Bonjour, nous avons bien…
[2026-04-02T10:00:02.400Z] [SMS_AI]      SMS réponse IA envoyé | sid=SM...
[2026-04-02T10:00:02.700Z] [SMS_ALERT]   Alerte interne envoyée | sid=SM...
[2026-04-02T10:00:03.000Z] [SUPABASE]    Appel manqué enregistré
[2026-04-02T10:00:03.000Z] [DONE]        Flux complet terminé pour +336...
```
