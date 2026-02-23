import { createClient } from "redis";
import { config } from "./config.js";

let redisClient = null;
const localCache = new Map();
const localSessionHistory = new Map();

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

function sessionKey(sessionId) {
  return `chat:session:${sessionId}`;
}

export async function getSessionHistory(sessionId) {
  if (!sessionId) {
    return [];
  }
  const key = sessionKey(sessionId);
  if (redisClient?.isOpen) {
    const raw = await redisClient.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const item = localSessionHistory.get(key);
  if (!item) {
    return [];
  }
  if (item.expireAt < Date.now()) {
    localSessionHistory.delete(key);
    return [];
  }
  return Array.isArray(item.value) ? item.value : [];
}

export async function setSessionHistory(sessionId, messages, ttlSec = 3600) {
  if (!sessionId) {
    return;
  }
  const key = sessionKey(sessionId);
  const safeMessages = Array.isArray(messages) ? messages.slice(-50) : [];
  if (redisClient?.isOpen) {
    await redisClient.setEx(key, ttlSec, JSON.stringify(safeMessages));
    return;
  }
  localSessionHistory.set(key, { value: safeMessages, expireAt: Date.now() + ttlSec * 1000 });
}
