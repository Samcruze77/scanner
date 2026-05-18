const app = require("./app");
const env = require("./config/env");
const { startCleanupScheduler } = require("./services/cleanupService");
const { pool } = require("./config/database");
const { initSocket } = require("./services/socketService");
const { startJobEventBridge } = require("./services/queueService");

async function bootstrap() {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected.");
  } catch (error) {
    console.warn("Database not available:", error.message);
  }

  startCleanupScheduler();
  const server = require("http").createServer(app);
  initSocket(server);
  startJobEventBridge();

  server.listen(env.port, () => {
    console.log(`API server running at ${env.apiBaseUrl}`);
  });
}

bootstrap();
