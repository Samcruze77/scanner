const Redis = require("ioredis");
const env = require("./env");

let connection;

function getRedis() {
  if (!connection) {
    connection = new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

module.exports = { getRedis };
