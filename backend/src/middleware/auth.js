const jwt = require("jsonwebtoken");
const env = require("../config/env");

function authenticate(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      if (required) {
        return res.status(401).json({ success: false, message: "Authentication required." });
      }
      req.user = null;
      return next();
    }

    try {
      const payload = jwt.verify(token, env.jwtSecret);
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role || "free",
        subscriptionPlan: payload.subscriptionPlan || payload.role || "free",
        plan: payload.subscriptionPlan || payload.role || "free",
      };
      return next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Session expired.", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ success: false, message: "Invalid token." });
    }
  };
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const userRole = req.user.role || req.user.subscriptionPlan;
    if (!roles.includes(userRole) && userRole !== "admin") {
      return res.status(403).json({ success: false, message: "Insufficient permissions." });
    }

    return next();
  };
}

function requirePremium(req, res, next) {
  return requireRoles("premium", "pro", "admin")(req, res, next);
}

module.exports = { authenticate, requireRoles, requirePremium };
