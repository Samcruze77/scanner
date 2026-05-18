const express = require("express");
const subscriptionService = require("../services/subscriptionService");
const { authenticate } = require("../middleware/auth");
const env = require("../config/env");

const router = express.Router();

router.post("/checkout", authenticate(), async (req, res, next) => {
  try {
    const session = await subscriptionService.createCheckoutSession(req.user.id, req.user.email);
    res.json({ success: true, data: { url: session.url } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
