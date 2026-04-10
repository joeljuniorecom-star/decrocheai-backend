require("dotenv").config();

const express = require("express");
const webhookRouter = require("./routes/webhook");
const { getRecentCalls } = require("./services/supabase");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Parsing ──────────────────────────────────────────────────────────────────
// Twilio envoie du application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

app.get("/calls", async (_req, res) => {
  try {
    const calls = await getRecentCalls(20);
    res.json({ count: calls.length, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/webhook", webhookRouter);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] DécrocheAI backend démarré sur 0.0.0.0:${PORT}`);
});
