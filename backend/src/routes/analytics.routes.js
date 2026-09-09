const express = require("express");
const analyticsService = require("../services/analyticsService");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/dashboard", authenticate(), async (_req, res, next) => {
  try {
    const stats = await analyticsService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
