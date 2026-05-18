const env = require("../config/env");

function premiumGate(req, res, next) {
  if (!env.enablePremiumGate) return next();

  const isPremium = req.headers["x-premium-user"] === "true";
  if (!isPremium) {
    return res.status(402).json({
      success: false,
      message: "Premium subscription required for this conversion.",
    });
  }

  return next();
}

module.exports = premiumGate;
