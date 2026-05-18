const express = require("express");
const env = require("../config/env");
const { pool } = require("../config/database");
const { getRedis } = require("../config/redis");

const router = express.Router();

router.get("/health", async (_req, res) => {
  const checks = {
    api: "ok",
    database: "unknown",
    redis: "unknown",
  };

  try {
    await pool.query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  try {
    await getRedis().ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const healthy = checks.database === "ok" && checks.redis === "ok";
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: "Document Converter API is running.",
    env: env.nodeEnv,
    maxFileSizeMB: env.maxFileSizeBytes / (1024 * 1024),
    checks,
  });
});

module.exports = router;
