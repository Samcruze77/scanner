const subscriptionService = require("../services/subscriptionService");

async function freemiumGuard(req, res, next) {
  if (!req.user?.id) return next();

  const plan = req.user.subscriptionPlan || req.user.role || req.user.plan || "free";
  const usage = await subscriptionService.checkAndIncrementUsage(req.user.id, plan);
  if (!usage.allowed) {
    return res.status(402).json({ success: false, message: usage.message, code: "FREEMIUM_LIMIT" });
  }

  return next();
}

module.exports = freemiumGuard;
