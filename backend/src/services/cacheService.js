const { getRedis } = require("../config/redis");
const env = require("../config/env");

async function cacheGet(key) {
  try {
    const redis = getRedis();
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = env.cacheTtlSeconds) {
  try {
    const redis = getRedis();
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    /* cache optional */
  }
}

async function cacheDel(key) {
  try {
    await getRedis().del(key);
  } catch {
    /* ignore */
  }
}

module.exports = { cacheGet, cacheSet, cacheDel };
