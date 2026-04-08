import crypto from "crypto";
import cors from "cors";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import * as Sentry from "@sentry/node";
import client from "prom-client";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { pool } from "./db.js";
import { cacheGet, cacheSet, getSessionHistory, initializeCache, setSessionHistory } from "./chatMemory.js";
import {
  hashPassword,
  readBearerToken,
  requireAuth,
  signRefreshToken,
  signToken,
  verifyPassword,
  verifyRefreshToken,
  verifyToken
} from "./auth.js";

const app = express();
const server = http.createServer(app);
app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 0.1
  });
}

const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });
const requestDuration = new client.Histogram({
  name: "gateway_http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [30, 50, 100, 200, 300, 500, 800, 1200, 2000],
  registers: [metricsRegistry]
});

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    requestDuration.observe(
      {
        method: req.method,
        route: req.route?.path || req.path || "unknown",
        status_code: String(res.statusCode)
      },
      durationMs
    );
  });
  next();
});

const wss = new WebSocketServer({ noServer: true });
const sessionClients = new Map();
const ACCESS_TOKEN_SKEW_SEC = 20;
const DEFAULT_TOOL_POLICY = {
  enabled: true,
  weather_use_current_location: true,
  tool_trigger_rules: "遇到即時資訊問題（天氣、營業時間、交通、票價、活動）時優先查工具。"
};

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const pairs = String(header).split(";").map((item) => item.trim()).filter(Boolean);
  const result = {};
  for (const item of pairs) {
    const idx = item.indexOf("=");
    if (idx < 0) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function setRefreshTokenCookie(res, refreshToken) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${config.refreshCookieName}=${encodeURIComponent(refreshToken)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearRefreshTokenCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${config.refreshCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function sanitizeToolPolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_TOOL_POLICY };
  }
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_TOOL_POLICY.enabled,
    weather_use_current_location:
      typeof input.weather_use_current_location === "boolean"
        ? input.weather_use_current_location
        : DEFAULT_TOOL_POLICY.weather_use_current_location,
    tool_trigger_rules:
      typeof input.tool_trigger_rules === "string" && input.tool_trigger_rules.trim()
        ? input.tool_trigger_rules.trim().slice(0, 1000)
        : DEFAULT_TOOL_POLICY.tool_trigger_rules
  };
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

async function fetchWeeklyCtrTrend({ weeks, userId }) {
  const safeWeeks = Math.min(26, Math.max(2, Number(weeks) || 8));
  const whereUser = Number.isFinite(userId) ? "AND user_id = $2" : "";
  const params = Number.isFinite(userId) ? [safeWeeks, userId] : [safeWeeks];
  const result = await pool.query(
    `
    WITH week_series AS (
      SELECT (date_trunc('week', NOW()) - (gs * INTERVAL '1 week'))::date AS week_start
      FROM generate_series(0, $1 - 1) AS gs
    ),
    agg AS (
      SELECT
        date_trunc('week', created_at)::date AS week_start,
        COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(DISTINCT user_id)::int AS unique_users
      FROM recommendation_events
      WHERE created_at >= date_trunc('week', NOW()) - (($1 - 1) * INTERVAL '1 week')
        ${whereUser}
      GROUP BY 1
    )
    SELECT
      ws.week_start,
      COALESCE(agg.impressions, 0)::int AS impressions,
      COALESCE(agg.clicks, 0)::int AS clicks,
      COALESCE(agg.unique_users, 0)::int AS unique_users
    FROM week_series ws
    LEFT JOIN agg ON agg.week_start = ws.week_start
    ORDER BY ws.week_start ASC
    `,
    params
  );
  const weekly = [];
  let previousCtr = null;
  for (const row of result.rows || []) {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const ctr = impressions > 0 ? round4(clicks / impressions) : 0;
    const wow = previousCtr === null ? null : round4(ctr - previousCtr);
    weekly.push({
      week_start: row.week_start,
      impressions,
      clicks,
      unique_users: Number(row.unique_users || 0),
      ctr,
      wow_ctr_change: wow
    });
    previousCtr = ctr;
  }
  return weekly;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

const ALLOWED_OLLAMA_MODELS = ["gemma4:26b", "gemma4:e4b"];

app.get("/api/models", (_req, res) => {
  const raw = (config.ollamaModel || "gemma4:e4b").trim();
  const selected = ALLOWED_OLLAMA_MODELS.includes(raw) ? raw : "gemma4:e4b";
  res.json({
    models: ALLOWED_OLLAMA_MODELS.map((name) => ({ name })),
    selected
  });
});

app.post("/api/auth/check-email", async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    res.status(400).json({ error: "email 為必填" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  res.json({ exists: result.rows.length > 0 });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, newPassword } = req.body || {};
  if (!email || !newPassword) {
    res.status(400).json({ error: "email 與 newPassword 為必填" });
    return;
  }
  if (String(newPassword).length < 6) {
    res.status(400).json({ error: "新密碼至少 6 個字元" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (!userResult.rows[0]) {
    res.status(404).json({ error: "找不到此電子郵件對應的帳戶" });
    return;
  }
  const newHash = await hashPassword(String(newPassword));
  await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, userResult.rows[0].id]);
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || String(password).length < 6) {
    res.status(400).json({ error: "email 與 password（至少 6 碼）為必填" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (exists.rows[0]) {
    res.status(409).json({ error: "此 email 已註冊" });
    return;
  }
  const passwordHash = await hashPassword(String(password));
  const result = await pool.query(
    `
    INSERT INTO users (email, password_hash)
    VALUES ($1, $2)
    RETURNING id, email, created_at
    `,
    [normalizedEmail, passwordHash]
  );
  await pool.query("INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [result.rows[0].id]);
  const token = signToken(result.rows[0]);
  const refreshToken = signRefreshToken(result.rows[0]);
  setRefreshTokenCookie(res, refreshToken);
  res.status(201).json({
    token,
    access_token: token,
    token_type: "Bearer",
    expires_in: 15 * 60 - ACCESS_TOKEN_SKEW_SEC,
    user: result.rows[0]
  });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "email 與 password 為必填" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await pool.query("SELECT id, email, password_hash, created_at FROM users WHERE email = $1", [normalizedEmail]);
  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: "帳號或密碼錯誤" });
    return;
  }
  const ok = await verifyPassword(String(password), user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "帳號或密碼錯誤" });
    return;
  }
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
  const token = signToken(user);
  const refreshToken = signRefreshToken(user);
  setRefreshTokenCookie(res, refreshToken);
  res.json({
    token,
    access_token: token,
    token_type: "Bearer",
    expires_in: 15 * 60 - ACCESS_TOKEN_SKEW_SEC,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at
    }
  });
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const refreshToken = cookies[config.refreshCookieName];
    if (!refreshToken) {
      res.status(401).json({ error: "missing refresh token" });
      return;
    }
    const payload = verifyRefreshToken(refreshToken);
    const userResult = await pool.query("SELECT id, email, created_at FROM users WHERE id = $1", [Number(payload.sub)]);
    const user = userResult.rows[0];
    if (!user) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: "invalid refresh token" });
      return;
    }
    const token = signToken(user);
    const nextRefreshToken = signRefreshToken(user);
    setRefreshTokenCookie(res, nextRefreshToken);
    res.json({
      token,
      access_token: token,
      token_type: "Bearer",
      expires_in: 15 * 60 - ACCESS_TOKEN_SKEW_SEC
    });
  } catch {
    clearRefreshTokenCookie(res);
    res.status(401).json({ error: "invalid refresh token" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT u.id, u.email, u.created_at, u.last_login_at, p.display_name
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = $1
    `,
    [req.user.id]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  res.json({ user: result.rows[0] });
});

app.post("/api/auth/logout", requireAuth, (_req, res) => {
  clearRefreshTokenCookie(res);
  res.json({ ok: true });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword 與 newPassword 為必填" });
    return;
  }
  if (String(newPassword).length < 6) {
    res.status(400).json({ error: "新密碼至少 6 個字元" });
    return;
  }
  const userResult = await pool.query("SELECT id, password_hash FROM users WHERE id = $1", [req.user.id]);
  const user = userResult.rows[0];
  if (!user) {
    res.status(404).json({ error: "找不到使用者" });
    return;
  }
  const ok = await verifyPassword(String(currentPassword), user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "目前密碼錯誤" });
    return;
  }
  const newHash = await hashPassword(String(newPassword));
  await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, req.user.id]);
  res.json({ ok: true });
});

app.delete("/api/auth/account", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM chat_sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_memories WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_ai_settings WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_profiles WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    clearRefreshTokenCookie(res);
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "刪除帳戶失敗" });
  } finally {
    client.release();
  }
});

app.get("/api/user/profile", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM user_profiles WHERE user_id = $1", [req.user.id]);
  if (!result.rows[0]) {
    await pool.query("INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [req.user.id]);
    const fallback = await pool.query("SELECT * FROM user_profiles WHERE user_id = $1", [req.user.id]);
    res.json({ profile: fallback.rows[0] || null });
    return;
  }
  res.json({ profile: result.rows[0] });
});

app.put("/api/user/profile", requireAuth, async (req, res) => {
  const {
    displayName,
    travelStyle,
    budgetPref,
    pacePref,
    transportPref,
    dietaryPref,
    preferredCities
  } = req.body || {};
  const result = await pool.query(
    `
    INSERT INTO user_profiles (
      user_id, display_name, travel_style, budget_pref, pace_pref, transport_pref, dietary_pref, preferred_cities, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, '[]'::jsonb), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
      travel_style = COALESCE(EXCLUDED.travel_style, user_profiles.travel_style),
      budget_pref = COALESCE(EXCLUDED.budget_pref, user_profiles.budget_pref),
      pace_pref = COALESCE(EXCLUDED.pace_pref, user_profiles.pace_pref),
      transport_pref = COALESCE(EXCLUDED.transport_pref, user_profiles.transport_pref),
      dietary_pref = COALESCE(EXCLUDED.dietary_pref, user_profiles.dietary_pref),
      preferred_cities = COALESCE(EXCLUDED.preferred_cities, user_profiles.preferred_cities),
      updated_at = NOW()
    RETURNING *
    `,
    [
      req.user.id,
      displayName ?? null,
      travelStyle ?? null,
      budgetPref ?? null,
      pacePref ?? null,
      transportPref ?? null,
      dietaryPref ?? null,
      Array.isArray(preferredCities) ? JSON.stringify(preferredCities) : null
    ]
  );
  res.json({ profile: result.rows[0] });
});

app.get("/api/user/ai-settings", requireAuth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT user_id, tool_policy_json, weather_default_region, auto_use_current_location, current_lat, current_lng, current_region, updated_at
    FROM user_ai_settings
    WHERE user_id = $1
    `,
    [req.user.id]
  );
  if (!result.rows[0]) {
    const created = await pool.query(
      `
      INSERT INTO user_ai_settings (user_id, tool_policy_json)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING user_id, tool_policy_json, weather_default_region, auto_use_current_location, current_lat, current_lng, current_region, updated_at
      `,
      [req.user.id, JSON.stringify(DEFAULT_TOOL_POLICY)]
    );
    res.json({ settings: created.rows[0] });
    return;
  }
  res.json({ settings: result.rows[0] });
});

app.put("/api/user/ai-settings", requireAuth, async (req, res) => {
  const { toolPolicy, weatherDefaultRegion, autoUseCurrentLocation } = req.body || {};
  const normalizedPolicy = sanitizeToolPolicy(toolPolicy);
  const result = await pool.query(
    `
    INSERT INTO user_ai_settings (
      user_id, tool_policy_json, weather_default_region, auto_use_current_location, updated_at
    ) VALUES ($1, $2::jsonb, $3, COALESCE($4, TRUE), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      tool_policy_json = COALESCE(EXCLUDED.tool_policy_json, user_ai_settings.tool_policy_json),
      weather_default_region = COALESCE(EXCLUDED.weather_default_region, user_ai_settings.weather_default_region),
      auto_use_current_location = COALESCE(EXCLUDED.auto_use_current_location, user_ai_settings.auto_use_current_location),
      updated_at = NOW()
    RETURNING user_id, tool_policy_json, weather_default_region, auto_use_current_location, current_lat, current_lng, current_region, updated_at
    `,
    [
      req.user.id,
      JSON.stringify(normalizedPolicy),
      weatherDefaultRegion ? String(weatherDefaultRegion).slice(0, 120) : null,
      typeof autoUseCurrentLocation === "boolean" ? autoUseCurrentLocation : null
    ]
  );
  res.json({ settings: result.rows[0] });
});

app.put("/api/user/location", requireAuth, async (req, res) => {
  const { lat, lng, region } = req.body || {};
  const hasLatLng = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const normalizedLat = hasLatLng ? Number(lat) : null;
  const normalizedLng = hasLatLng ? Number(lng) : null;
  const normalizedRegion = region ? String(region).trim().slice(0, 120) : null;
  const result = await pool.query(
    `
    INSERT INTO user_ai_settings (
      user_id, tool_policy_json, current_lat, current_lng, current_region, updated_at
    ) VALUES ($1, $2::jsonb, $3, $4, $5, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      current_lat = COALESCE(EXCLUDED.current_lat, user_ai_settings.current_lat),
      current_lng = COALESCE(EXCLUDED.current_lng, user_ai_settings.current_lng),
      current_region = COALESCE(EXCLUDED.current_region, user_ai_settings.current_region),
      updated_at = NOW()
    RETURNING user_id, tool_policy_json, weather_default_region, auto_use_current_location, current_lat, current_lng, current_region, updated_at
    `,
    [req.user.id, JSON.stringify(DEFAULT_TOOL_POLICY), normalizedLat, normalizedLng, normalizedRegion]
  );
  res.json({ settings: result.rows[0] });
});

app.get("/api/user/memory", requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const result = await pool.query(
    `
    SELECT id, memory_type, memory_text, confidence, source, created_at
    FROM user_memories
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [req.user.id, limit]
  );
  res.json({ items: result.rows });
});

app.post("/api/user/memory", requireAuth, async (req, res) => {
  const { memoryType, memoryText, confidence = 0.8, source = "manual" } = req.body || {};
  if (!memoryType || !memoryText) {
    res.status(400).json({ error: "memoryType 與 memoryText 為必填" });
    return;
  }
  const result = await pool.query(
    `
    INSERT INTO user_memories (user_id, memory_type, memory_text, confidence, source)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, memory_type, memory_text, confidence, source, created_at
    `,
    [req.user.id, String(memoryType), String(memoryText), Number(confidence) || 0.8, String(source)]
  );
  res.status(201).json({ item: result.rows[0] });
});

app.post("/api/user/memory/rebuild", requireAuth, async (req, res) => {
  try {
    const result = await saveAiReviewedMemories(req.user.id);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({
      error: "AI 記憶巡檢失敗",
      detail: error instanceof Error ? error.message : "unknown error"
    });
  }
});

// ---------------------------------------------------------------------------
// Recommendation event tracking
// ---------------------------------------------------------------------------

app.post("/api/recommendation/event", requireAuth, async (req, res) => {
  const {
    event_type, session_id, query_text, query_intent, tool_source,
    video_id, segment_id, youtube_id, rank_position, rank_score,
    recommendation_reason, location_source, personalization_signals,
    feedback_action, dwell_time_ms
  } = req.body || {};
  const validTypes = ["impression", "click", "segment_jump", "itinerary_adopt", "dismiss", "like", "unlike"];
  if (!event_type || !validTypes.includes(event_type)) {
    res.status(400).json({ error: `event_type must be one of: ${validTypes.join(", ")}` });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO recommendation_events
        (user_id, session_id, event_type, query_text, query_intent, tool_source,
         video_id, segment_id, youtube_id, rank_position, rank_score,
         recommendation_reason, location_source, personalization_signals,
         feedback_action, dwell_time_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
      [
        req.user.id,
        session_id || null,
        event_type,
        query_text || null,
        query_intent || null,
        tool_source || null,
        video_id || null,
        segment_id || null,
        youtube_id || null,
        rank_position ?? null,
        rank_score ?? null,
        recommendation_reason || null,
        location_source || null,
        JSON.stringify(personalization_signals || {}),
        feedback_action || null,
        dwell_time_ms ?? null
      ]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("[recommendation_event] insert failed:", error.message);
    res.status(500).json({ error: "event insert failed" });
  }
});

app.post("/api/recommendation/more", requireAuth, async (req, res) => {
  const { exclude_youtube_ids, last_query, city, limit } = req.body || {};
  const excludeIds = Array.isArray(exclude_youtube_ids) ? exclude_youtube_ids.filter((id) => typeof id === "string") : [];
  const query = typeof last_query === "string" ? last_query.trim() : "";
  const limitNum = Math.min(20, Math.max(1, parseInt(limit, 10) || 5));
  try {
    const response = await fetch(`${config.aiServiceUrl}/api/recommendation/more`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
      },
      body: JSON.stringify({
        user_id: req.user.id,
        exclude_youtube_ids: excludeIds,
        last_query: query || "旅遊",
        city: city || null,
        limit: limitNum
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      res.status(response.status).json({ error: text || "recommendation/more failed" });
      return;
    }
    const data = await response.json().catch(() => ({}));
    res.json({ recommended_videos: data.recommended_videos ?? [] });
  } catch (error) {
    console.error("[recommendation/more] request failed:", error.message);
    res.status(502).json({ error: "recommendation service unavailable" });
  }
});

app.get("/api/recommendation/metrics", requireAuth, async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
  try {
    const result = await pool.query(
      `SELECT
         event_type,
         COUNT(*) AS count,
         COUNT(DISTINCT user_id) AS unique_users,
         AVG(rank_score) AS avg_rank_score,
         AVG(dwell_time_ms) FILTER (WHERE dwell_time_ms > 0) AS avg_dwell_ms
       FROM recommendation_events
       WHERE created_at >= NOW() - make_interval(days => $1)
         AND user_id = $2
       GROUP BY event_type
       ORDER BY count DESC`,
      [days, req.user.id]
    );
    const impressions = result.rows.find(r => r.event_type === "impression");
    const clicks = result.rows.find(r => r.event_type === "click");
    const impressionCount = parseInt(impressions?.count || "0");
    const clickCount = parseInt(clicks?.count || "0");
    const ctr = impressionCount > 0 ? (clickCount / impressionCount) : 0;

    res.json({
      days,
      events: result.rows,
      summary: {
        total_impressions: impressionCount,
        total_clicks: clickCount,
        click_through_rate: round4(ctr)
      }
    });
  } catch (error) {
    console.error("[recommendation_metrics] query failed:", error.message);
    res.status(500).json({ error: "metrics query failed" });
  }
});

app.get("/api/recommendation/ctr-weekly", requireAuth, async (req, res) => {
  const weeks = Math.min(26, Math.max(2, parseInt(req.query.weeks) || 8));
  try {
    const weekly = await fetchWeeklyCtrTrend({ weeks, userId: req.user.id });
    res.json({
      weeks,
      scope: "user",
      user_id: req.user.id,
      weekly
    });
  } catch (error) {
    console.error("[recommendation_ctr_weekly] query failed:", error.message);
    res.status(500).json({ error: "ctr weekly query failed" });
  }
});

app.get("/api/chat/sessions", requireAuth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT s.id, s.external_session_id, s.title, s.created_at,
           (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.session_id = s.id) AS last_message_at
    FROM chat_sessions s
    WHERE s.user_id = $1
    ORDER BY last_message_at DESC NULLS LAST, s.created_at DESC
    LIMIT 100
    `,
    [req.user.id]
  );
  const sessions = (result.rows || []).map((row) => ({
    id: row.id,
    external_session_id: row.external_session_id,
    title: row.title || "旅遊對話",
    created_at: row.created_at,
    last_message_at: row.last_message_at
  }));
  res.json({ sessions });
});

app.get("/api/chat/history/:sessionId", requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId;
  const sessionRow = await pool.query(
    `
    SELECT id
    FROM chat_sessions
    WHERE user_id = $1 AND external_session_id = $2
    `,
    [req.user.id, sessionId]
  );
  if (!sessionRow.rows[0]) {
    res.json({ sessionId, messages: [] });
    return;
  }
  const messages = await pool.query(
    `
    SELECT role, content, meta_json, created_at
    FROM chat_messages
    WHERE session_id = $1
    ORDER BY id ASC
    `,
    [sessionRow.rows[0].id]
  );
  res.json({ sessionId, messages: messages.rows });
});

app.delete("/api/chat/history/:sessionId", requireAuth, async (req, res) => {
  const sessionId = req.params.sessionId;
  await pool.query(
    `
    DELETE FROM chat_sessions
    WHERE user_id = $1 AND external_session_id = $2
    `,
    [req.user.id, sessionId]
  );
  res.json({ ok: true });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const body = req.body || {};
  const sessionId = body.sessionId || `user-${req.user.id}`;
  const traceId = generateTraceId();
  const chatStartMs = Date.now();
  const chatSessionDbId = await ensureChatSession(req.user.id, sessionId);
  const incomingMessages = normalizeChatMessages(body.messages);
  const cachedHistory = await getSessionHistory(sessionId);
  let mergedHistory = normalizeChatMessages([...cachedHistory, ...incomingMessages]);
  if (sessionId && body.message) {
    if (config.enableGatewayMemoryExtract) {
      await saveExtractedMemories(req.user.id, String(body.message));
    }
    const userText = String(body.message);
    await saveChatMessage(chatSessionDbId, "user", userText, {});
    mergedHistory = normalizeChatMessages([...mergedHistory, { role: "user", content: userText }]);
    await setSessionHistory(sessionId, mergedHistory, 3600);
  }

  const response = await fetch(`${config.aiServiceUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": traceId,
      ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
    },
    body: JSON.stringify({
      ...body,
      messages: mergedHistory,
      session_id: sessionId,
      user_id: req.user.id,
      trace_id: traceId
    })
  });

  if (!response.ok || !response.body) {
    const fallbackReply = buildFallbackReply(body.message);
    const fallbackHistory = normalizeChatMessages([...mergedHistory, { role: "assistant", content: fallbackReply }]);
    await saveChatMessage(chatSessionDbId, "assistant", fallbackReply, {
      recommended_videos: [],
      fallback: true
    });
    await setSessionHistory(sessionId, fallbackHistory, 3600);
    insertAuditLog({
      traceId,
      userId: req.user.id,
      sessionId,
      endpoint: "/api/chat",
      method: "POST",
      statusCode: response.status || 502,
      requestJson: { message: body.message, model: body.model },
      responseJson: { fallback: true },
      errorText: "ai-service unavailable, used fallback reply",
      durationMs: Date.now() - chatStartMs
    }).catch(() => {});
    if (body.stream === false) {
      res.json({
        reply: fallbackReply,
        recommended_videos: [],
        fallback: true
      });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ token: fallbackReply }, null, 0)}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true, recommended_videos: [], fallback: true }, null, 0)}\n\n`);
    if (sessionId) {
      broadcastToSession(sessionId, {
        type: "stream_response",
        sessionId,
        chunk: `data: ${JSON.stringify({ token: fallbackReply })}\n\ndata: ${JSON.stringify({ done: true, recommended_videos: [], fallback: true })}\n\n`
      });
    }
    res.end();
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const data = await response.json();
    if (data.reply) {
      await saveChatMessage(chatSessionDbId, "assistant", String(data.reply), {
        recommended_videos: data.recommended_videos ?? []
      });
      await setSessionHistory(
        sessionId,
        normalizeChatMessages([...mergedHistory, { role: "assistant", content: String(data.reply) }]),
        3600
      );
    }
    insertAuditLog({
      traceId,
      userId: req.user.id,
      sessionId,
      endpoint: "/api/chat",
      method: "POST",
      statusCode: response.status,
      requestJson: { message: body.message, model: body.model, city: body.city, stream: body.stream },
      responseJson: { reply_length: String(data.reply || "").length, tool_calls_summary: data.tool_calls_summary },
      toolCallsJson: data.tool_calls_summary || [],
      durationMs: Date.now() - chatStartMs
    }).catch(() => {});
    res.json(data);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let assistantText = "";
  let recommendedVideos = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      assistantText += extractTokenText(chunk);
      recommendedVideos = mergeRecommendedVideos(recommendedVideos, extractRecommendedVideos(chunk));
      if (sessionId) {
        broadcastToSession(sessionId, {
          type: "stream_response",
          sessionId,
          chunk
        });
      }
      res.write(encoder.encode(chunk));
    }
  } finally {
    if (assistantText.trim()) {
      await saveChatMessage(chatSessionDbId, "assistant", assistantText, {
        recommended_videos: recommendedVideos
      });
      await setSessionHistory(
        sessionId,
        normalizeChatMessages([...mergedHistory, { role: "assistant", content: assistantText }]),
        3600
      );
    }
    insertAuditLog({
      traceId,
      userId: req.user.id,
      sessionId,
      endpoint: "/api/chat",
      method: "POST",
      statusCode: 200,
      requestJson: { message: body.message, model: body.model, city: body.city, stream: body.stream },
      responseJson: { assistant_text_length: assistantText.length, recommended_videos_count: recommendedVideos.length },
      durationMs: Date.now() - chatStartMs
    }).catch(() => {});
    res.end();
  }
});

app.post("/api/search-segments", requireAuth, async (req, res) => {
  const payload = req.body || {};
  const cacheKey = `search:${req.user.id}:${JSON.stringify(payload)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const response = await fetch(`${config.aiServiceUrl}/api/tools/search-segments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) {
    await cacheSet(cacheKey, JSON.stringify(data), 180);
  }
  res.status(response.status).json(data);
});

app.get("/api/videos/by-youtube/:youtubeId/segments", requireAuth, async (req, res) => {
  const { youtubeId } = req.params;
  const response = await fetch(
    `${config.aiServiceUrl}/api/videos/by-youtube/${encodeURIComponent(youtubeId)}/segments`
  );
  const data = await response.json().catch(() => []);
  res.status(response.status).json(data);
});

app.get("/api/videos/:videoId/segments", requireAuth, async (req, res) => {
  const { videoId } = req.params;
  const response = await fetch(`${config.aiServiceUrl}/api/videos/${videoId}/segments`);
  const data = await response.json().catch(() => []);
  res.status(response.status).json(data);
});

const VIDEO_OUTLINE_COOLDOWN_MS = 30_000;
const videoOutlineLastCall = new Map();

app.post("/api/videos/by-youtube/:youtubeId/ai-outline", requireAuth, async (req, res) => {
  const { youtubeId } = req.params;
  const userId = req.user?.id ?? "anon";
  const key = `${userId}:yt:${youtubeId}`;
  const now = Date.now();
  const last = videoOutlineLastCall.get(key) || 0;
  if (now - last < VIDEO_OUTLINE_COOLDOWN_MS) {
    res.status(429).json({
      error: "rate_limited",
      retry_after_ms: VIDEO_OUTLINE_COOLDOWN_MS - (now - last)
    });
    return;
  }
  videoOutlineLastCall.set(key, now);
  const response = await fetch(
    `${config.aiServiceUrl}/api/videos/by-youtube/${encodeURIComponent(youtubeId)}/ai-outline`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
      },
      body: JSON.stringify(req.body || {})
    }
  );
  const data = await response.json().catch(() => ({}));
  res.status(response.status).json(data);
});

app.post("/api/videos/preview-ai-outline", requireAuth, async (req, res) => {
  const userId = req.user?.id ?? "anon";
  const key = `${userId}:preview:${JSON.stringify(req.body || {})
    .slice(0, 120)}`;
  const now = Date.now();
  const last = videoOutlineLastCall.get(key) || 0;
  if (now - last < VIDEO_OUTLINE_COOLDOWN_MS) {
    res.status(429).json({
      error: "rate_limited",
      retry_after_ms: VIDEO_OUTLINE_COOLDOWN_MS - (now - last)
    });
    return;
  }
  videoOutlineLastCall.set(key, now);
  const response = await fetch(`${config.aiServiceUrl}/api/videos/preview-ai-outline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
    },
    body: JSON.stringify(req.body || {})
  });
  const data = await response.json().catch(() => ({}));
  res.status(response.status).json(data);
});

app.post("/api/videos/:videoId/ai-outline", requireAuth, async (req, res) => {
  const { videoId } = req.params;
  const userId = req.user?.id ?? "anon";
  const key = `${userId}:${videoId}`;
  const now = Date.now();
  const last = videoOutlineLastCall.get(key) || 0;
  if (now - last < VIDEO_OUTLINE_COOLDOWN_MS) {
    res.status(429).json({
      error: "rate_limited",
      retry_after_ms: VIDEO_OUTLINE_COOLDOWN_MS - (now - last)
    });
    return;
  }
  videoOutlineLastCall.set(key, now);
  const response = await fetch(`${config.aiServiceUrl}/api/videos/${videoId}/ai-outline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
    },
    body: JSON.stringify(req.body || {})
  });
  const data = await response.json().catch(() => ({}));
  res.status(response.status).json(data);
});

function normalizeItineraryDays(rawDays) {
  if (!Array.isArray(rawDays)) {
    return [];
  }
  return rawDays
    .map((day, dayIndex) => {
      if (!day || typeof day !== "object") {
        return null;
      }
      const dateLabel = String(day.date_label || day.label || "").trim();
      const rawSlots = Array.isArray(day.slots) ? day.slots : [];
      const slots = rawSlots
        .map((slot, slotIndex) => {
          if (!slot || typeof slot !== "object") {
            return null;
          }
          const placeName = String(slot.place_name || slot.name || "").trim();
          if (!placeName) {
            return null;
          }
          return {
            place_name: placeName,
            place_id: Number(slot.place_id) || null,
            segment_id: Number(slot.segment_id) || null,
            slot_order: Number.isFinite(Number(slot.slot_order)) ? Number(slot.slot_order) : slotIndex + 1,
            time_range_start: slot.time_range_start || null,
            time_range_end: slot.time_range_end || null
          };
        })
        .filter(Boolean);
      return {
        day_number: Number.isFinite(Number(day.day_number)) ? Number(day.day_number) : dayIndex + 1,
        date_label: dateLabel || null,
        slots
      };
    })
    .filter(Boolean);
}

async function replaceItineraryDaysAndSlots(client, itineraryId, normalizedDays) {
  await client.query(
    `DELETE FROM itinerary_slots
     WHERE day_id IN (
       SELECT id FROM itinerary_days WHERE itinerary_id = $1
     )`,
    [itineraryId]
  );
  await client.query("DELETE FROM itinerary_days WHERE itinerary_id = $1", [itineraryId]);

  for (const day of normalizedDays) {
    const dayResult = await client.query(
      `
      INSERT INTO itinerary_days (itinerary_id, day_number, date_label)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [itineraryId, day.day_number, day.date_label]
    );
    const dayId = dayResult.rows[0]?.id;
    if (!dayId) {
      continue;
    }
    for (const slot of day.slots) {
      await client.query(
        `
        INSERT INTO itinerary_slots
          (day_id, time_range_start, time_range_end, place_name, place_id, segment_id, slot_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          dayId,
          slot.time_range_start,
          slot.time_range_end,
          slot.place_name,
          slot.place_id,
          slot.segment_id,
          slot.slot_order
        ]
      );
    }
  }
}

app.get("/api/itinerary", requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const result = await pool.query(
    `
    SELECT id, session_id, title, days_count, status, created_at, updated_at
    FROM itineraries
    WHERE user_id = $1
    ORDER BY updated_at DESC, id DESC
    LIMIT $2
    `,
    [req.user.id, limit]
  );
  res.json({ items: result.rows, total: result.rows.length });
});

app.post("/api/itinerary/reoptimize", requireAuth, async (req, res) => {
  const body = req.body || {};
  const days = Math.min(14, Math.max(1, Number(body.days) || 1));
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const preferences = Array.isArray(body.preferences) ? body.preferences : [];
  const mustVisit = Array.isArray(body.mustVisit) ? body.mustVisit : [];
  const avoid = Array.isArray(body.avoid) ? body.avoid : [];
  const payload = {
    days,
    segments,
    preferences,
    user_id: req.user.id,
    budget_total: Number(body.budgetTotal) > 0 ? Number(body.budgetTotal) : null,
    budget_per_day: Number(body.budgetPerDay) > 0 ? Number(body.budgetPerDay) : null,
    must_visit: mustVisit,
    avoid
  };

  try {
    const response = await fetch(`${config.aiServiceUrl}/api/tools/plan-itinerary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.aiServiceInternalToken ? { "x-internal-token": config.aiServiceInternalToken } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (error) {
    console.error("[itinerary_reoptimize] request failed:", error.message);
    res.status(502).json({ error: "reoptimize request failed" });
  }
});

app.post("/api/itinerary", requireAuth, async (req, res) => {
  const { sessionId, title, daysCount = 1, status = "draft", days = [] } = req.body || {};
  const resolvedSessionId = sessionId || `user-${req.user.id}`;
  const normalizedDays = normalizeItineraryDays(days);
  const client = await pool.connect();
  let created = null;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      INSERT INTO itineraries (session_id, user_id, title, days_count, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [resolvedSessionId, req.user.id, title || null, Number(daysCount) || 1, status]
    );
    created = result.rows[0] || null;
    if (created && normalizedDays.length > 0) {
      await replaceItineraryDaysAndSlots(client, created.id, normalizedDays);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[itinerary_create] failed:", error.message);
    res.status(500).json({ error: "itinerary create failed" });
    client.release();
    return;
  }
  client.release();
  if (!created) {
    res.status(500).json({ error: "itinerary create failed" });
    return;
  }
  if (resolvedSessionId) {
    broadcastToSession(resolvedSessionId, {
      type: "itinerary_update",
      action: "created",
      itinerary: created
    });
  }
  res.status(201).json(created);
});

function parseItineraryId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

app.get("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = parseItineraryId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "invalid itinerary id" });
    return;
  }
  const itinerary = await pool.query("SELECT * FROM itineraries WHERE id = $1 AND user_id = $2", [id, req.user.id]);
  if (!itinerary.rows[0]) {
    res.status(404).json({ error: "itinerary not found" });
    return;
  }
  const days = await pool.query("SELECT * FROM itinerary_days WHERE itinerary_id = $1 ORDER BY day_number ASC", [id]);
  const dayIds = days.rows.map((row) => row.id);
  let slots = [];
  if (dayIds.length > 0) {
    const slotResult = await pool.query(
      `
      SELECT id, day_id, time_range_start, time_range_end, place_name, place_id, segment_id, slot_order
      FROM itinerary_slots
      WHERE day_id = ANY($1::int[])
      ORDER BY day_id ASC, slot_order ASC, id ASC
      `,
      [dayIds]
    );
    slots = slotResult.rows;
  }
  const slotByDayId = new Map();
  for (const slot of slots) {
    const group = slotByDayId.get(slot.day_id) || [];
    group.push(slot);
    slotByDayId.set(slot.day_id, group);
  }
  const daysWithSlots = days.rows.map((day) => ({
    ...day,
    slots: slotByDayId.get(day.id) || []
  }));
  res.json({ ...itinerary.rows[0], days: daysWithSlots });
});

app.put("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = parseItineraryId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "invalid itinerary id" });
    return;
  }
  const { title, daysCount, status, days } = req.body || {};
  const normalizedDays = normalizeItineraryDays(days);
  const client = await pool.connect();
  let updated = null;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      UPDATE itineraries
      SET title = COALESCE($2, title),
          days_count = COALESCE($3, days_count),
          status = COALESCE($4, status),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $5
      RETURNING *
      `,
      [id, title ?? null, daysCount ?? null, status ?? null, req.user.id]
    );
    updated = result.rows[0] || null;
    if (updated && Array.isArray(days)) {
      await replaceItineraryDaysAndSlots(client, id, normalizedDays);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[itinerary_update] failed:", error.message);
    res.status(500).json({ error: "itinerary update failed" });
    client.release();
    return;
  }
  client.release();
  if (!updated) {
    res.status(404).json({ error: "itinerary not found" });
    return;
  }
  if (updated.session_id) {
    broadcastToSession(updated.session_id, {
      type: "itinerary_update",
      action: "updated",
      itinerary: updated
    });
  }
  res.json(updated);
});

app.delete("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = parseItineraryId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "invalid itinerary id" });
    return;
  }
  const existing = await pool.query("SELECT session_id FROM itineraries WHERE id = $1 AND user_id = $2", [id, req.user.id]);
  const result = await pool.query("DELETE FROM itineraries WHERE id = $1 AND user_id = $2 RETURNING id", [id, req.user.id]);
  if (!result.rows[0]) {
    res.status(404).json({ error: "itinerary not found" });
    return;
  }
  const sessionId = existing.rows[0]?.session_id;
  if (sessionId) {
    broadcastToSession(sessionId, {
      type: "itinerary_update",
      action: "deleted",
      itineraryId: id
    });
  }
  res.json({ ok: true, id });
});

function extractTokenText(chunk) {
  const lines = chunk.split("\n");
  let text = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const body = line.slice(5).trim();
    if (!body) {
      continue;
    }
    try {
      const parsed = JSON.parse(body);
      if (parsed.token) {
        text += String(parsed.token);
      }
    } catch {
      // Ignore invalid chunks.
    }
  }
  return text;
}

function normalizePersonName(rawName) {
  const value = String(rawName || "")
    .trim()
    .replace(/^[「『"'\s]+|[」』"'\s]+$/g, "")
    .replace(/[，。！？,.。!?]+$/g, "");
  if (!value) {
    return "";
  }
  const blocked = new Set([
    "誰",
    "你",
    "我",
    "他",
    "她",
    "它",
    "您",
    "名字",
    "姓名",
    "稱呼",
    "暱稱",
    "本人"
  ]);
  if (blocked.has(value) || value.length > 20) {
    return "";
  }
  return value;
}

function extractMemoriesFromMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return [];
  }
  const memories = [];

  const normalized = text.replace(/\s+/g, " ").trim();
  const pushMemory = (memoryType, memoryText, confidence, source = "chat_auto_long") => {
    const cleaned = String(memoryText || "").replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 2) {
      return;
    }
    memories.push({ memoryType, memoryText: cleaned.slice(0, 300), confidence, source });
  };

  const nameMatch = normalized.match(/(?:我叫|我是)\s*([^\s，。！？,.]{1,20})/);
  const normalizedName = normalizePersonName(nameMatch?.[1] || "");
  if (normalizedName) {
    pushMemory("identity", `使用者姓名或稱呼：${normalizedName}`, 0.93);
  }

  const visitedPatterns = [/我(?:之前)?去過([^，。！？,.]{1,25})/, /我曾去過([^，。！？,.]{1,25})/, /我玩過([^，。！？,.]{1,25})/];
  for (const pattern of visitedPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      pushMemory("visited_place", `使用者去過：${match[1].trim()}`, 0.88);
      break;
    }
  }

  if (/(我喜歡|偏好|我通常|我習慣|我想要)/.test(normalized)) {
    pushMemory("preference", normalized, 0.86);
  }
  if (/(我不吃|過敏|不要|不想|避免)/.test(normalized)) {
    pushMemory("constraint", normalized, 0.9);
  }
  if (/(預算|花費|省錢|高預算|低預算)/.test(normalized)) {
    pushMemory("budget", normalized, 0.82);
  }
  if (/(節奏|行程|慢慢|緊湊|鬆一點|快一點)/.test(normalized)) {
    pushMemory("pace", normalized, 0.78);
  }
  if (/(交通|開車|大眾運輸|捷運|公車|步行|騎車)/.test(normalized)) {
    pushMemory("transport", normalized, 0.78);
  }

  const unique = [];
  const seen = new Set();
  for (const item of memories) {
    const key = `${item.memoryType}:${item.memoryText}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique.slice(0, 5);
}

function parseJsonArrayFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] || raw;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const firstBracket = candidate.indexOf("[");
    const lastBracket = candidate.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const sliced = candidate.slice(firstBracket, lastBracket + 1);
      try {
        const parsed = JSON.parse(sliced);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

function sanitizeAiMemoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const memoryType = String(item.memoryType || "").trim().toLowerCase();
  const allowedTypes = new Set(["identity", "preference", "constraint", "budget", "pace", "transport", "visited_place"]);
  if (!allowedTypes.has(memoryType)) {
    return null;
  }
  let memoryText = String(item.memoryText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (!memoryText) {
    return null;
  }

  if (memoryType === "identity") {
    const nameFromText = memoryText.startsWith("使用者姓名或稱呼：")
      ? memoryText.slice("使用者姓名或稱呼：".length)
      : memoryText;
    const normalizedName = normalizePersonName(nameFromText);
    if (!normalizedName) {
      return null;
    }
    memoryText = `使用者姓名或稱呼：${normalizedName}`;
  }

  const confidenceValue = Number(item.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0.5, Math.min(0.99, confidenceValue)) : 0.8;
  return {
    memoryType,
    memoryText,
    confidence,
    source: "chat_ai_review"
  };
}

async function extractMemoriesByAiReview(userId) {
  const messageRows = await pool.query(
    `
    SELECT m.role, m.content, m.created_at
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE s.user_id = $1
    ORDER BY m.created_at DESC
    LIMIT 80
    `,
    [userId]
  );
  if (!messageRows.rows.length) {
    return [];
  }

  const memoryRows = await pool.query(
    `
    SELECT memory_type, memory_text, confidence
    FROM user_memories
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 25
    `,
    [userId]
  );

  const dialogueText = messageRows.rows
    .slice()
    .reverse()
    .map((row, index) => `${index + 1}. [${row.role}] ${String(row.content || "").replace(/\s+/g, " ").slice(0, 260)}`)
    .join("\n");
  const existingMemoryText = memoryRows.rows
    .map(
      (row, index) =>
        `${index + 1}. [${row.memory_type}] ${row.memory_text} (confidence=${row.confidence})`
    )
    .join("\n");

  const systemPrompt =
    "你是記憶萃取器。請根據對話內容抽取可長期保留的使用者事實。僅回傳 JSON 陣列，不要任何額外文字。";
  const userPrompt = `
請從以下資料萃取「值得長期記錄」的記憶，並輸出 JSON 陣列。
每個元素格式必須是：
{"memoryType":"identity|preference|constraint|budget|pace|transport|visited_place","memoryText":"...", "confidence":0.5~0.99}

規則：
1) 僅抽取由使用者明確表達或高可信推論的內容。
2) memoryText 要簡潔、可重用，避免整段複製。
3) identity 僅在姓名明確時才輸出，且格式固定為「使用者姓名或稱呼：XXX」。
4) 不要輸出「誰、你、我、姓名、名字」這類非姓名值。
5) 若沒有可新增內容，回傳空陣列 []。

[近期對話]
${dialogueText}

[既有記憶]
${existingMemoryText || "（無）"}
`.trim();

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[memory ai review] Ollama returned non-OK:", response.status, text.slice(0, 200));
      return [];
    }
    const data = await response.json().catch(() => ({}));
    const content = data?.message?.content || "";
    const parsedItems = parseJsonArrayFromText(content);
    return parsedItems.map(sanitizeAiMemoryItem).filter(Boolean).slice(0, 12);
  } catch (err) {
    console.warn("[memory ai review] skipped:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function saveExtractedMemories(userId, message) {
  const memories = extractMemoriesFromMessage(message);
  if (memories.length === 0) {
    return;
  }
  for (const item of memories) {
    const exists = await pool.query(
      `
      SELECT id
      FROM user_memories
      WHERE user_id = $1 AND memory_type = $2 AND memory_text = $3
      LIMIT 1
      `,
      [userId, item.memoryType, item.memoryText]
    );
    if (exists.rows[0]) {
      continue;
    }
    await pool.query(
      `
      INSERT INTO user_memories (user_id, memory_type, memory_text, confidence, source)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, item.memoryType, item.memoryText, item.confidence, item.source]
    );
  }
}

async function saveAiReviewedMemories(userId) {
  await pool.query(
    `
    DELETE FROM user_memories
    WHERE user_id = $1
      AND memory_type = 'identity'
      AND memory_text IN ('使用者姓名或稱呼：誰', '使用者姓名或稱呼：你', '使用者姓名或稱呼：我')
    `,
    [userId]
  );

  const candidates = await extractMemoriesByAiReview(userId);
  let inserted = 0;
  let skipped = 0;
  for (const item of candidates) {
    const exists = await pool.query(
      `
      SELECT id
      FROM user_memories
      WHERE user_id = $1 AND memory_type = $2 AND memory_text = $3
      LIMIT 1
      `,
      [userId, item.memoryType, item.memoryText]
    );
    if (exists.rows[0]) {
      skipped += 1;
      continue;
    }
    await pool.query(
      `
      INSERT INTO user_memories (user_id, memory_type, memory_text, confidence, source)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, item.memoryType, item.memoryText, item.confidence, item.source]
    );
    inserted += 1;
  }
  return {
    inserted,
    skipped,
    candidates: candidates.length
  };
}

async function ensureChatSession(userId, externalSessionId) {
  const existing = await pool.query(
    `
    SELECT id
    FROM chat_sessions
    WHERE user_id = $1 AND external_session_id = $2
    `,
    [userId, externalSessionId]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const created = await pool.query(
    `
    INSERT INTO chat_sessions (user_id, external_session_id, title)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    [userId, externalSessionId, "旅遊對話"]
  );
  return created.rows[0].id;
}

async function saveChatMessage(sessionDbId, role, content, meta) {
  await pool.query(
    `
    INSERT INTO chat_messages (session_id, role, content, meta_json)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [sessionDbId, role, content, JSON.stringify(meta || {})]
  );
}

function extractRecommendedVideos(chunk) {
  const lines = chunk.split("\n");
  const items = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const body = line.slice(5).trim();
    if (!body) {
      continue;
    }
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed.recommended_videos)) {
        items.push(...parsed.recommended_videos);
      }
    } catch {
      // Ignore malformed json chunk.
    }
  }
  return items;
}

function recommendationMergeKey(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const yt = item.youtube_id;
  if (typeof yt === "string" && yt.trim() !== "") {
    return `yt:${yt.trim()}`;
  }
  const vid = item.video_id;
  if (typeof vid === "number" && Number.isFinite(vid) && vid !== 0) {
    return `id:${vid}`;
  }
  if (typeof vid === "string" && vid.trim() !== "") {
    return `id:${vid.trim()}`;
  }
  const tit = item.title;
  if (typeof tit === "string" && tit.trim() !== "") {
    return `title:${tit.trim().slice(0, 120)}`;
  }
  return null;
}

function mergeRecommendedVideos(current, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return current;
  }
  const map = new Map();
  for (const item of current || []) {
    const k = recommendationMergeKey(item);
    if (k) {
      map.set(k, item);
    }
  }
  for (const item of incoming) {
    const k = recommendationMergeKey(item);
    if (k) {
      map.set(k, item);
    }
  }
  return Array.from(map.values()).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Developer console helpers
// ---------------------------------------------------------------------------

const DEV_ADMIN_EMAIL = "admin@gmail.com";
const DEV_ADMIN_PASSWORD = "adminadmin";
const DEV_JWT_SECRET = config.jwtSecret + "_dev";
const SENSITIVE_KEYS = new Set([
  "password", "password_hash", "token", "access_token", "refresh_token",
  "authorization", "cookie", "set-cookie", "x-internal-token",
  "secret", "api_key", "apikey"
]);

function maskSensitivePayload(obj, depth = 0) {
  if (depth > 8 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitivePayload(item, depth + 1));
  }
  if (typeof obj === "object") {
    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        masked[key] = typeof value === "string" && value.length > 0 ? "***MASKED***" : value;
      } else {
        masked[key] = maskSensitivePayload(value, depth + 1);
      }
    }
    return masked;
  }
  return obj;
}

function generateTraceId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

async function insertAuditLog({
  traceId, userId, sessionId, endpoint, method, statusCode,
  requestJson, responseJson, aiPromptJson, aiResponseJson,
  toolCallsJson, errorText, durationMs
}) {
  try {
    const maskedReq = maskSensitivePayload(requestJson);
    const maskedRes = maskSensitivePayload(responseJson);
    const maskedPrompt = maskSensitivePayload(aiPromptJson);
    const maskedAiRes = maskSensitivePayload(aiResponseJson);
    const maskedTools = maskSensitivePayload(toolCallsJson);
    await pool.query(
      `INSERT INTO developer_audit_logs
        (trace_id, user_id, session_id, endpoint, method, status_code,
         request_json, response_json, ai_prompt_json, ai_response_json,
         tool_calls_json, error_text, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)`,
      [
        traceId || null,
        userId || null,
        sessionId || null,
        endpoint || null,
        method || null,
        statusCode || null,
        JSON.stringify(maskedReq || {}),
        JSON.stringify(maskedRes || {}),
        JSON.stringify(maskedPrompt || {}),
        JSON.stringify(maskedAiRes || {}),
        JSON.stringify(maskedTools || []),
        errorText || null,
        durationMs || null
      ]
    );
  } catch (e) {
    console.error("[audit] insert failed:", e.message);
  }
}

async function insertDevLoginEvent({ email, success, ip, userAgent }) {
  try {
    await pool.query(
      "INSERT INTO developer_login_events (email, success, ip_address, user_agent) VALUES ($1,$2,$3,$4)",
      [email, success, ip || null, userAgent || null]
    );
  } catch (e) {
    console.error("[audit] login event insert failed:", e.message);
  }
}

function signDevToken(email) {
  return jwt.sign({ email, role: "dev_admin" }, DEV_JWT_SECRET, { expiresIn: "8h" });
}

function requireDevAdmin(req, res, next) {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "dev console disabled in production" });
    return;
  }
  try {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw || "";
    if (!header.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing dev token" });
      return;
    }
    const token = header.slice(7).trim();
    const payload = jwt.verify(token, DEV_JWT_SECRET);
    if (payload.role !== "dev_admin") throw new Error("bad role");
    req.devAdmin = { email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "invalid dev token" });
  }
}

// --- Dev auth routes ---

app.post("/api/dev/login", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "dev console disabled in production" });
    return;
  }
  const { email, password } = req.body || {};
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  if (email === DEV_ADMIN_EMAIL && password === DEV_ADMIN_PASSWORD) {
    await insertDevLoginEvent({ email, success: true, ip, userAgent: ua });
    const token = signDevToken(email);
    res.json({ token, email });
  } else {
    await insertDevLoginEvent({ email: email || "", success: false, ip, userAgent: ua });
    res.status(401).json({ error: "invalid credentials" });
  }
});

app.post("/api/dev/logout", requireDevAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/dev/me", requireDevAdmin, (req, res) => {
  res.json({ email: req.devAdmin.email, role: "dev_admin" });
});

// --- Quality dashboard ---

app.get("/api/dev/quality-dashboard", requireDevAdmin, async (_req, res) => {
  try {
    const recEvents = await pool.query(`
      SELECT event_type, COUNT(*) AS count
      FROM recommendation_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY event_type
      ORDER BY count DESC
    `);
    const impressions = parseInt(recEvents.rows.find(r => r.event_type === "impression")?.count || "0");
    const clicks = parseInt(recEvents.rows.find(r => r.event_type === "click")?.count || "0");
    const segJumps = parseInt(recEvents.rows.find(r => r.event_type === "segment_jump")?.count || "0");

    const toolSuccess = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE (tool_calls_json::text) LIKE '%"ok": true%' OR (tool_calls_json::text) LIKE '%"ok":true%') AS success_count,
        COUNT(*) AS total_count
      FROM developer_audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND endpoint = '/api/chat'
        AND tool_calls_json IS NOT NULL
        AND tool_calls_json::text != '[]'
    `);
    const toolTotal = parseInt(toolSuccess.rows[0]?.total_count || "0");
    const toolOk = parseInt(toolSuccess.rows[0]?.success_count || "0");

    const chatPerf = await pool.query(`
      SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
        AVG(duration_ms) AS avg_ms,
        COUNT(*) AS total_requests
      FROM developer_audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND endpoint = '/api/chat'
        AND duration_ms IS NOT NULL
    `);

    const activeUsers = await pool.query(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM developer_audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND user_id IS NOT NULL
    `);

    const ctrWeekly = await fetchWeeklyCtrTrend({ weeks: 8 });

    res.json({
      period: "last 7 days",
      recommendation: {
        events: recEvents.rows,
        impressions,
        clicks,
        segment_jumps: segJumps,
        ctr: impressions > 0 ? round4(clicks / impressions) : 0,
        ctr_weekly: ctrWeekly
      },
      tool_calling: {
        total: toolTotal,
        success: toolOk,
        success_rate: toolTotal > 0 ? round4(toolOk / toolTotal) : 0,
      },
      chat_performance: chatPerf.rows[0] || {},
      active_users: parseInt(activeUsers.rows[0]?.count || "0"),
    });
  } catch (error) {
    console.error("[quality-dashboard] query failed:", error.message);
    res.status(500).json({ error: "dashboard query failed" });
  }
});

app.get("/api/dev/recommendation/ctr-weekly", requireDevAdmin, async (req, res) => {
  const weeks = Math.min(26, Math.max(2, parseInt(req.query.weeks) || 8));
  try {
    const weekly = await fetchWeeklyCtrTrend({ weeks });
    res.json({
      weeks,
      scope: "global",
      weekly
    });
  } catch (error) {
    console.error("[dev_recommendation_ctr_weekly] query failed:", error.message);
    res.status(500).json({ error: "dev ctr weekly query failed" });
  }
});

// --- Dev data routes ---

app.get("/api/dev/users", requireDevAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.created_at,
            p.display_name, p.bio
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.id
     ORDER BY u.id`
  );
  res.json({ users: result.rows });
});

app.get("/api/dev/users/:id/profile", requireDevAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const [userRow, profileRow, aiRow] = await Promise.all([
    pool.query("SELECT id, email, created_at FROM users WHERE id = $1", [uid]),
    pool.query("SELECT * FROM user_profiles WHERE user_id = $1", [uid]),
    pool.query("SELECT * FROM user_ai_settings WHERE user_id = $1", [uid])
  ]);
  if (!userRow.rows[0]) { res.status(404).json({ error: "user not found" }); return; }
  res.json({
    user: userRow.rows[0],
    profile: profileRow.rows[0] || null,
    ai_settings: aiRow.rows[0] || null
  });
});

app.get("/api/dev/users/:id/memories", requireDevAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    "SELECT * FROM user_memories WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2",
    [uid, limit]
  );
  res.json({ memories: result.rows });
});

app.get("/api/dev/users/:id/chat-sessions", requireDevAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.external_session_id AS session_id, s.title, s.created_at,
            (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.session_id = s.id) AS updated_at
     FROM chat_sessions s WHERE s.user_id = $1
     ORDER BY updated_at DESC NULLS LAST, s.created_at DESC LIMIT $2`,
    [uid, limit]
  );
  res.json({ sessions: result.rows });
});

app.get("/api/dev/users/:id/chat-history/:sessionId", requireDevAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const sessionId = req.params.sessionId;
  const sessionRow = await pool.query(
    "SELECT id FROM chat_sessions WHERE user_id = $1 AND external_session_id = $2",
    [uid, sessionId]
  );
  if (!sessionRow.rows[0]) {
    res.json({ messages: [] });
    return;
  }
  const result = await pool.query(
    `SELECT m.id, m.role, m.content, m.meta_json AS metadata, m.created_at
     FROM chat_messages m
     WHERE m.session_id = $1
     ORDER BY m.id ASC`,
    [sessionRow.rows[0].id]
  );
  res.json({ messages: result.rows });
});

app.get("/api/dev/users/:id/itineraries", requireDevAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const result = await pool.query(
    "SELECT * FROM itineraries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
    [uid]
  );
  res.json({ itineraries: result.rows });
});

app.get("/api/dev/audit-logs", requireDevAdmin, async (req, res) => {
  const { user_id, endpoint, trace_id, from, to, limit: rawLimit, offset: rawOffset } = req.query;
  const limit = Math.min(Number(rawLimit) || 50, 200);
  const offset = Number(rawOffset) || 0;
  const conditions = [];
  const params = [];
  let idx = 1;
  if (user_id) { conditions.push(`user_id = $${idx++}`); params.push(Number(user_id)); }
  if (endpoint) { conditions.push(`endpoint ILIKE $${idx++}`); params.push(`%${endpoint}%`); }
  if (trace_id) { conditions.push(`trace_id = $${idx++}`); params.push(trace_id); }
  if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`created_at <= $${idx++}`); params.push(to); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const countResult = await pool.query(`SELECT COUNT(*) AS total FROM developer_audit_logs ${where}`, params);
  params.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM developer_audit_logs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );
  res.json({ total: Number(countResult.rows[0].total), logs: result.rows });
});

app.get("/api/dev/login-events", requireDevAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    "SELECT * FROM developer_login_events ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  res.json({ events: result.rows });
});

// ---------------------------------------------------------------------------

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((item) => ({
      role: item?.role === "assistant" || item?.role === "system" ? item.role : "user",
      content: String(item?.content || "").trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-50);
}

function buildFallbackReply(lastUserMessage) {
  const text = String(lastUserMessage || "").trim();
  const head = text ? `你剛剛提到：「${text.slice(0, 80)}」。` : "我收到你的需求了。";
  return `${head}目前個人化模型服務暫時不可用，我先以短期對話內容提供建議。請稍後再試一次，系統恢復後會自動帶入長期偏好。`;
}

function parseWsMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function addClientToSession(sessionId, ws) {
  const set = sessionClients.get(sessionId) || new Set();
  set.add(ws);
  sessionClients.set(sessionId, set);
}

function removeClientFromSession(sessionId, ws) {
  const set = sessionClients.get(sessionId);
  if (!set) {
    return;
  }
  set.delete(ws);
  if (set.size === 0) {
    sessionClients.delete(sessionId);
  }
}

function broadcastToSession(sessionId, payload) {
  const set = sessionClients.get(sessionId);
  if (!set || set.size === 0) {
    return;
  }
  const body = JSON.stringify(payload);
  for (const client of set) {
    if (client.readyState === 1) {
      client.send(body);
    }
  }
}

wss.on("connection", (ws, request, user) => {
  ws.sessionId = "";
  ws.user = user || null;

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "websocket connected",
      userId: ws.user?.id ?? null
    })
  );

  ws.on("message", (raw) => {
    const data = parseWsMessage(raw);
    if (!data || typeof data.type !== "string") {
      ws.send(JSON.stringify({ type: "error", message: "invalid websocket payload" }));
      return;
    }

    if (data.type === "subscribe" && typeof data.sessionId === "string" && data.sessionId) {
      if (ws.user && !data.sessionId.startsWith(`user-${ws.user.id}`)) {
        ws.send(JSON.stringify({ type: "error", message: "unauthorized session scope" }));
        return;
      }
      if (ws.sessionId) {
        removeClientFromSession(ws.sessionId, ws);
      }
      ws.sessionId = data.sessionId;
      addClientToSession(ws.sessionId, ws);
      ws.send(JSON.stringify({ type: "subscribed", sessionId: ws.sessionId }));
      return;
    }

    if (data.type === "message") {
      const sessionId = typeof data.sessionId === "string" ? data.sessionId : ws.sessionId;
      if (sessionId) {
        broadcastToSession(sessionId, {
          type: "message",
          sessionId,
          payload: data.payload ?? null
        });
      }
      return;
    }

    ws.send(JSON.stringify({ type: "error", message: "unknown websocket event type" }));
  });

  ws.on("close", () => {
    if (ws.sessionId) {
      removeClientFromSession(ws.sessionId, ws);
    }
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const tokenFromQuery = url.searchParams.get("token") || "";
  const token = tokenFromQuery || readBearerToken({ headers: request.headers });
  let user = null;
  try {
    const payload = verifyToken(token);
    user = { id: Number(payload.sub), email: payload.email };
  } catch {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, user);
  });
});

await initializeCache();

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`api-gateway running on http://localhost:${config.port}`);
});
