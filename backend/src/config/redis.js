const Redis = require("ioredis");
const env = require("./env");

let connection;

function getRedis() {
  if (env.skipRedis) {
    throw new Error("Redis is disabled (SKIP_REDIS=true).");
  }

  if (!connection) {
    connection = new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return connection;
}

module.exports = { getRedis };
