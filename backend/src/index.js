const app = require("./app");
const env = require("./config/env");
const { startCleanupScheduler } = require("./services/cleanupService");
const { pool } = require("./config/database");
const { initSocket } = require("./services/socketService");
const { startJobEventBridge } = require("./services/queueService");

async function runMigrations() {
  const fs = require("fs");
  const path = require("path");
  const files = ["schema.sql", "auth-schema.sql", "oauth-schema.sql"];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(__dirname, "db", file), "utf8");
    await pool.query(sql);
  }
  console.log("Database migrations applied.");
}

async function bootstrap() {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected.");
    if (env.nodeEnv !== "production" && !env.useMemoryDb) {
      await runMigrations();
    }
  } catch (error) {
    console.warn("Database not available:", error.message);
  }

  startCleanupScheduler();
  const server = require("http").createServer(app);
  initSocket(server);
  if (!env.skipRedis) {
    startJobEventBridge();
  } else {
    console.log("Redis queue disabled (SKIP_REDIS=true). Auth and API work; conversions need Redis.");
  }

  server.listen(env.port, () => {
    console.log(`API server running at ${env.apiBaseUrl}`);
  });
}

bootstrap();
