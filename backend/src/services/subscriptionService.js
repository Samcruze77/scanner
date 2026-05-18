const Stripe = require("stripe");
const { pool } = require("../config/database");
const env = require("../config/env");

let stripe;

function getStripe() {
  if (!stripe && env.stripe.secretKey) {
    stripe = new Stripe(env.stripe.secretKey);
  }
  return stripe;
}

async function checkAndIncrementUsage(userId, plan) {
  if (plan === "pro" || plan === "premium" || plan === "admin") return { allowed: true };

  const result = await pool.query("SELECT conversions_today, conversions_reset_at, plan FROM users WHERE id = $1", [
    userId,
  ]);
  const user = result.rows[0];
  if (!user) return { allowed: true };

  const today = new Date().toISOString().slice(0, 10);
  let conversionsToday = user.conversions_today;

  if (String(user.conversions_reset_at).slice(0, 10) !== today) {
    conversionsToday = 0;
    await pool.query(
      `UPDATE users SET conversions_today = 0, conversions_reset_at = CURRENT_DATE WHERE id = $1`,
      [userId]
    );
  }

  if (conversionsToday >= env.freemium.freeDailyLimit) {
    return {
      allowed: false,
      message: `Free plan limit reached (${env.freemium.freeDailyLimit}/day). Upgrade to Pro.`,
    };
  }

  await pool.query(`UPDATE users SET conversions_today = conversions_today + 1 WHERE id = $1`, [userId]);
  return { allowed: true };
}

async function createCheckoutSession(userId, email) {
  const client = getStripe();
  if (!client || !env.stripe.priceProMonthly) {
    const error = new Error("Stripe is not configured.");
    error.status = 503;
    throw error;
  }

  return client.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [{ price: env.stripe.priceProMonthly, quantity: 1 }],
    success_url: `${env.apiBaseUrl}/billing/success`,
    cancel_url: `${env.apiBaseUrl}/billing/cancel`,
    metadata: { userId },
  });
}

async function handleWebhook(event) {
  if (event.type === "checkout.session.completed") {
    const userId = event.data.object.metadata?.userId;
    if (userId) {
      await pool.query(`UPDATE users SET plan = 'pro' WHERE id = $1`, [userId]);
    }
  }
}

module.exports = { checkAndIncrementUsage, createCheckoutSession, handleWebhook, getStripe };
