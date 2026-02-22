import { createClient } from "redis";
import { config } from "./config.js";

let redisClient = null;
const localCache = new Map();

// Keep Redis only for general API caching, not chat history.
export async function initializeCache() {
  if (!config.redisUrl) {
    return;
  }
  try {
    redisClient = createClient({ url: config.redisUrl });
    redisClient.on("error", () => {
      // Fallback to local cache when redis errors out.
    });
    await redisClient.connect();
  } catch {
    redisClient = null;
  }
}

export async function cacheGet(key) {
  if (redisClient?.isOpen) {
    return redisClient.get(key);
  }
  const item = localCache.get(key);
  if (!item) {
    return null;
  }
  if (item.expireAt < Date.now()) {
    localCache.delete(key);
    return null;
  }
  return item.value;
}

export async function cacheSet(key, value, ttlSec = 120) {
  if (redisClient?.isOpen) {
    await redisClient.setEx(key, ttlSec, value);
    return;
  }
  localCache.set(key, { value, expireAt: Date.now() + ttlSec * 1000 });
}
