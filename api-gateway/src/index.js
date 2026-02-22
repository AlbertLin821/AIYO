import cors from "cors";
import express from "express";
import http from "http";
import morgan from "morgan";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { pool } from "./db.js";
import { cacheGet, cacheSet, initializeCache } from "./chatMemory.js";
import { hashPassword, readBearerToken, requireAuth, signToken, verifyPassword, verifyToken } from "./auth.js";

const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const wss = new WebSocketServer({ noServer: true });
const sessionClients = new Map();

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!response.ok) {
      res.json({
        models: config.ollamaModel ? [{ name: config.ollamaModel }] : [],
        selected: config.ollamaModel
      });
      return;
    }
    const data = await response.json();
    const names = Array.from(
      new Set((data.models || []).map((item) => item?.name).filter((name) => typeof name === "string"))
    );
    if (names.length === 0 && config.ollamaModel) {
      names.push(config.ollamaModel);
    }
    res.json({ models: names.map((name) => ({ name })), selected: config.ollamaModel || names[0] || "" });
  } catch {
    res.json({
      models: config.ollamaModel ? [{ name: config.ollamaModel }] : [],
      selected: config.ollamaModel
    });
  }
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
  res.status(201).json({ token, user: result.rows[0] });
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
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at
    }
  });
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
  res.json({ ok: true });
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
  const chatSessionDbId = await ensureChatSession(req.user.id, sessionId);
  if (sessionId && body.message) {
    await saveExtractedMemories(req.user.id, String(body.message));
    await saveChatMessage(chatSessionDbId, "user", String(body.message), {});
  }

  const response = await fetch(`${config.aiServiceUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      session_id: sessionId,
      user_id: req.user.id
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    res.status(502).json({ error: "ai-service unavailable", detail: text });
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const data = await response.json();
    if (data.reply) {
      await saveChatMessage(chatSessionDbId, "assistant", String(data.reply), {
        recommended_videos: data.recommended_videos ?? []
      });
    }
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
    }
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) {
    await cacheSet(cacheKey, JSON.stringify(data), 180);
  }
  res.status(response.status).json(data);
});

app.post("/api/itinerary", requireAuth, async (req, res) => {
  const { sessionId, title, daysCount = 1, status = "draft" } = req.body || {};
  const resolvedSessionId = sessionId || `user-${req.user.id}`;
  const result = await pool.query(
    `
    INSERT INTO itineraries (session_id, user_id, title, days_count, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [resolvedSessionId, req.user.id, title || null, Number(daysCount) || 1, status]
  );
  if (resolvedSessionId) {
    broadcastToSession(resolvedSessionId, {
      type: "itinerary_update",
      action: "created",
      itinerary: result.rows[0]
    });
  }
  res.status(201).json(result.rows[0]);
});

app.get("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const itinerary = await pool.query("SELECT * FROM itineraries WHERE id = $1 AND user_id = $2", [id, req.user.id]);
  if (!itinerary.rows[0]) {
    res.status(404).json({ error: "itinerary not found" });
    return;
  }
  const days = await pool.query("SELECT * FROM itinerary_days WHERE itinerary_id = $1 ORDER BY day_number ASC", [id]);
  res.json({ ...itinerary.rows[0], days: days.rows });
});

app.put("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { title, daysCount, status } = req.body || {};
  const result = await pool.query(
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
  if (!result.rows[0]) {
    res.status(404).json({ error: "itinerary not found" });
    return;
  }
  if (result.rows[0].session_id) {
    broadcastToSession(result.rows[0].session_id, {
      type: "itinerary_update",
      action: "updated",
      itinerary: result.rows[0]
    });
  }
  res.json(result.rows[0]);
});

app.delete("/api/itinerary/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
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

function extractMemoriesFromMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return [];
  }
  const memories = [];
  if (text.includes("我喜歡")) {
    memories.push({ memoryType: "preference", memoryText: text, confidence: 0.85, source: "chat" });
  }
  if (text.includes("我不吃") || text.includes("不要")) {
    memories.push({ memoryType: "constraint", memoryText: text, confidence: 0.9, source: "chat" });
  }
  if (text.includes("預算")) {
    memories.push({ memoryType: "budget", memoryText: text, confidence: 0.8, source: "chat" });
  }
  if (text.includes("節奏") || text.includes("行程")) {
    memories.push({ memoryType: "pace", memoryText: text, confidence: 0.75, source: "chat" });
  }
  return memories.slice(0, 3);
}

async function saveExtractedMemories(userId, message) {
  const memories = extractMemoriesFromMessage(message);
  if (memories.length === 0) {
    return;
  }
  for (const item of memories) {
    await pool.query(
      `
      INSERT INTO user_memories (user_id, memory_type, memory_text, confidence, source)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, item.memoryType, item.memoryText, item.confidence, item.source]
    );
  }
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

function mergeRecommendedVideos(current, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return current;
  }
  const map = new Map(current.map((item) => [item.video_id, item]));
  for (const item of incoming) {
    if (item && typeof item.video_id === "number") {
      map.set(item.video_id, item);
    }
  }
  return Array.from(map.values()).slice(0, 5);
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
