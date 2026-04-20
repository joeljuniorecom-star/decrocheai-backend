require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const webhookRouter = require("./routes/webhook");
const smsRouter = require("./routes/sms");
const stripeRouter = require("./routes/stripe");
const onboardingRouter = require("./routes/onboarding");
const { getRecentCalls } = require("./services/supabase");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// ── Stripe webhook: raw body MUST be parsed before express.json() ─────────────
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// ── Parsing ───────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Webhook Twilio : 200 req/min max (protection flood/scan)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// API interne : 60 req/min max
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// ── Authentification API key ──────────────────────────────────────────────────
function apiKeyAuth(req, res, next) {
  if (!process.env.API_KEY) {
    return res.status(503).json({ error: "API_KEY not configured on server" });
  }
  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

// Endpoint protégé : liste des appels récents
app.get("/calls", apiLimiter, apiKeyAuth, async (_req, res) => {
  try {
    const calls = await getRecentCalls(20);
    res.json({ count: calls.length, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/webhook", webhookLimiter, webhookRouter);
app.use("/webhook", webhookLimiter, smsRouter);

// ── Stripe ────────────────────────────────────────────────────────────────────
app.use("/api/stripe", apiLimiter, stripeRouter);

// ── Onboarding ────────────────────────────────────────────────────────────────
app.use("/api/onboarding", apiLimiter, onboardingRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] DécrocheAI backend démarré sur 0.0.0.0:${PORT}`);
});
