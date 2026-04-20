const express = require("express");
const router = express.Router();
const getStripe = require("../services/stripe");
const { supabase } = require("../services/supabase");

function log(step, msg, extra = "") {
  console.log(`[${new Date().toISOString()}] [${step}] ${msg}${extra ? " | " + extra : ""}`);
}

// ── Auth middleware: verify Supabase JWT ─────────────────────────────────────

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const token = auth.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.user = user;
  next();
}

// ── POST /api/stripe/create-checkout-session ─────────────────────────────────
// Creates an embedded Stripe Checkout session for the yearly subscription.
// Frontend uses the returned clientSecret to render EmbeddedCheckout.

router.post("/create-checkout-session", requireAuth, async (req, res) => {
  const { id: userId, email } = req.user;
  const frontendUrl = process.env.FRONTEND_URL || "https://decrocheai.online";

  if (!process.env.STRIPE_PRICE_ID) {
    return res.status(503).json({ error: "STRIPE_PRICE_ID not configured" });
  }

  try {
    // Retrieve or create Stripe customer
    let customerId;
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      const customer = await getStripe().customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .upsert({ id: userId, email, stripe_customer_id: customerId, updated_at: new Date().toISOString() });
    }

    const session = await getStripe().checkout.sessions.create({
      ui_mode: "embedded",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      return_url: `${frontendUrl}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
    });

    log("STRIPE", "Checkout session created", `user=${userId} session=${session.id}`);
    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    log("STRIPE", "Error creating session", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Receives Stripe events. Requires raw body (set in server.js before express.json).

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    log("STRIPE_WH", "STRIPE_WEBHOOK_SECRET not set — rejecting");
    return res.status(503).send("Webhook secret not configured");
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    log("STRIPE_WH", "Signature verification failed", err.message);
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  log("STRIPE_WH", `Event received: ${event.type}`);

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object);
    } else if (event.type === "customer.subscription.updated") {
      await handleSubscriptionUpdated(event.data.object);
    } else if (event.type === "customer.subscription.deleted") {
      await handleSubscriptionDeleted(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    log("STRIPE_WH", "Handler error", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const userId = session.client_reference_id;
  const subscriptionId = session.subscription;
  const customerId = session.customer;

  if (!userId) {
    log("STRIPE_WH", "checkout.session.completed missing client_reference_id — skipping");
    return;
  }

  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    subscription_status: "active",
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Supabase update failed: ${error.message}`);
  log("STRIPE_WH", "subscription_status set to active", `user=${userId}`);
}

async function handleSubscriptionUpdated(subscription) {
  // Map Stripe statuses to our enum
  const statusMap = {
    active: "active",
    past_due: "past_due",
    canceled: "cancelled",
    unpaid: "past_due",
    trialing: "active",
  };

  const newStatus = statusMap[subscription.status] || "pending";

  // Find user by stripe_subscription_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single();

  if (!profile) {
    log("STRIPE_WH", "subscription.updated: no matching profile", `sub=${subscription.id}`);
    return;
  }

  await supabase
    .from("profiles")
    .update({ subscription_status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", profile.id);

  log("STRIPE_WH", `subscription_status → ${newStatus}`, `user=${profile.id}`);
}

async function handleSubscriptionDeleted(subscription) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single();

  if (!profile) return;

  await supabase
    .from("profiles")
    .update({ subscription_status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", profile.id);

  log("STRIPE_WH", "subscription_status → cancelled", `user=${profile.id}`);
}

module.exports = router;
