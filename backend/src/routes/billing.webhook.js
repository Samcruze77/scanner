const subscriptionService = require("../services/subscriptionService");
const env = require("../config/env");

async function stripeWebhook(req, res) {
  const stripe = subscriptionService.getStripe();
  if (!stripe || !env.stripe.webhookSecret) {
    return res.status(503).json({ success: false, message: "Stripe webhook not configured." });
  }

  try {
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, env.stripe.webhookSecret);
    await subscriptionService.handleWebhook(event);
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = stripeWebhook;
