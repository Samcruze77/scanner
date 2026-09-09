const express = require("express");
const env = require("../config/env");
const { pool } = require("../config/database");

const router = express.Router();

router.get("/health", async (req, res) => {
  const checks = { api: "ok", database: "unknown", redis: env.skipRedis ? "skipped" : "unknown" };

  try {
    await pool.query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  if (!env.skipRedis) {
    try {
      const { getRedis } = require("../config/redis");
      const redis = getRedis();
      await redis.connect();
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "error";
    }
  }

  const healthy = checks.database === "ok" && (checks.redis === "ok" || checks.redis === "skipped");
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? "healthy" : "degraded",
    checks,
  });
});

module.exports = router;
