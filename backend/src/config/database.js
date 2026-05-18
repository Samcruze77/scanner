const { Pool } = require("pg");
const env = require("./env");
const logger = require("./logger");

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  logger.error("Unexpected DB error", { error: err });
});

module.exports = { pool };
