const Stripe = require("stripe");

let _client = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }
  if (!_client) {
    _client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-03-31.basil",
    });
  }
  return _client;
}

module.exports = getStripe;
