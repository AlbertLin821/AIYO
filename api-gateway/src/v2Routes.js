import crypto from "crypto";
import express from "express";
import { readBearerToken, verifyToken } from "./auth.js";

function generateTraceId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

function normalizeTraceId(raw) {
  const text = String(raw || "").trim();
  if (/^[a-fA-F0-9]{12,64}$/.test(text)) {
    return text.toLowerCase();
  }
  return generateTraceId();
}

function parseIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNullableString(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function hasLegacyPlaceId(input, depth = 0) {
  if (depth > 8 || input === null || input === undefined) return false;
  if (Array.isArray(input)) {
    return input.some((item) => hasLegacyPlaceId(item, depth + 1));
  }
  if (typeof input === "object") {
    if (Object.prototype.hasOwnProperty.call(input, "placeId")) {
      return true;
    }
    return Object.values(input).some((item) => hasLegacyPlaceId(item, depth + 1));
  }
  return false;
}

function normalizeRenderableItem(item) {
  if (!item || typeof item !== "object") {
    return {
      internalPlaceId: null,
      googlePlaceId: null,
      segmentId: null,
      lat: null,
      lng: null,
      startSec: null,
      endSec: null,
      reason: [],
      statsUpdatedAt: null,
      statsStale: true
    };
  }
  if (Object.prototype.hasOwnProperty.call(item, "placeId")) {
    throw new Error("legacy placeId is not allowed");
  }
  return {
    ...item,
    internalPlaceId: toNullableString(item.internalPlaceId ?? item.internal_place_id ?? null),
    googlePlaceId: toNullableString(item.googlePlaceId ?? item.google_place_id ?? null),
    segmentId: toNullableString(item.segmentId ?? item.segment_id ?? null),
    lat: typeof item.lat === "number" ? item.lat : null,
    lng: typeof item.lng === "number" ? item.lng : null,
    startSec: parseIntOrNull(item.startSec ?? item.start_sec ?? null),
    endSec: parseIntOrNull(item.endSec ?? item.end_sec ?? null),
    reason: Array.isArray(item.reason) ? item.reason.map((v) => String(v)) : [],
    statsUpdatedAt: toNullableString(item.statsUpdatedAt ?? item.stats_updated_at ?? null),
    statsStale: typeof item.statsStale === "boolean" ? item.statsStale : true
  };
}

function normalizeV2ResponseData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const out = { ...data };

  if (out.result && typeof out.result === "object") {
    const result = { ...out.result };
    if (Array.isArray(result.items)) {
      result.items = result.items.map(normalizeRenderableItem);
    }
    if (Array.isArray(result.recommendations)) {
      result.recommendations = result.recommendations.map(normalizeRenderableItem);
    }
    if (result.plan && typeof result.plan === "object" && Array.isArray(result.plan.days)) {
      result.plan = { ...result.plan };
      result.plan.days = result.plan.days.map((day) => {
        if (!day || typeof day !== "object" || !Array.isArray(day.stops)) {
          return day;
        }
        return { ...day, stops: day.stops.map(normalizeRenderableItem) };
      });
      if (Array.isArray(result.plan.unmappedSegments)) {
        result.plan.unmappedSegments = result.plan.unmappedSegments.map(normalizeRenderableItem);
      }
    }
    out.result = result;
  }
  return out;
}

async function proxyToAiService({ config, path, traceId, method = "GET", payload }) {
  const response = await fetch(`${config.aiServiceUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": traceId,
      ...(config.aiServiceInternalToken
        ? { "x-internal-token": config.aiServiceInternalToken }
        : {})
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text().catch(() => "upstream error") };
  return { ok: response.ok, status: response.status, data };
}

async function fetchJobStatusFromAi({ config, traceId, jobId, kind }) {
  const pathCandidates =
    kind === "plan"
      ? [`/api/v2/trips/plan-jobs/${encodeURIComponent(jobId)}`]
      : kind === "recommend"
        ? [`/api/v2/recommend/jobs/${encodeURIComponent(jobId)}`]
        : [
            `/api/v2/recommend/jobs/${encodeURIComponent(jobId)}`,
            `/api/v2/trips/plan-jobs/${encodeURIComponent(jobId)}`
          ];

  for (const path of pathCandidates) {
    const upstream = await proxyToAiService({
      config,
      path,
      traceId,
      method: "GET"
    });
    if (upstream.status === 404) {
      continue;
    }
    return upstream;
  }
  return { ok: false, status: 404, data: { error: "job not found" } };
}

export async function fetchV2JobStatus({ config, traceId, jobId, kind }) {
  const upstream = await fetchJobStatusFromAi({ config, traceId, jobId, kind });
  const data = normalizeV2ResponseData(upstream.data || {});
  data.traceId = data.traceId || traceId;
  return { ...upstream, data };
}

function authenticateSseRequest(req) {
  const queryToken =
    typeof req.query.accessToken === "string" ? req.query.accessToken.trim() : "";
  const token = queryToken || readBearerToken(req);
  if (!token) {
    return null;
  }
  try {
    const payload = verifyToken(token);
    return { id: Number(payload.sub), email: payload.email };
  } catch {
    return null;
  }
}

export function registerV1ReadOnlyGuard(app, config) {
  app.use((req, res, next) => {
    if (!config.v1ReadonlyMode) {
      next();
      return;
    }
    const method = String(req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      next();
      return;
    }
    const path = String(req.path || "");
    if (!path.startsWith("/api/")) {
      next();
      return;
    }
    if (path.startsWith("/api/v2/")) {
      next();
      return;
    }
    const exclusions = Array.isArray(config.v1ReadonlyExcludedPrefixes)
      ? config.v1ReadonlyExcludedPrefixes
      : [];
    if (exclusions.some((prefix) => prefix && path.startsWith(prefix))) {
      next();
      return;
    }
    res.status(410).json({
      error: "v1_readonly",
      message: "V1 API is in read-only mode. Please migrate to /api/v2/*.",
      migrateTo: "/api/v2/*",
      legacyFrontend: config.legacyFrontendPath || "/legacy"
    });
  });
}

export function registerV2Routes({ app, config, requireAuth }) {
  const router = express.Router();
  router.use((req, res, next) => {
    const incoming = req.headers["x-trace-id"];
    const headerTrace = Array.isArray(incoming) ? incoming[0] : incoming;
    req.traceId = normalizeTraceId(headerTrace);
    res.setHeader("x-trace-id", req.traceId);
    next();
  });

  router.post("/voice/intent", requireAuth, async (req, res) => {
    try {
      const upstream = await proxyToAiService({
        config,
        path: "/api/v2/voice/intent",
        traceId: req.traceId,
        method: "POST",
        payload: req.body || {}
      });
      const body = { ...(upstream.data || {}), traceId: upstream.data?.traceId || req.traceId };
      res.status(upstream.status).json(body);
    } catch (error) {
      res.status(502).json({ error: "v2 voice intent unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.post("/recommend/videos", requireAuth, async (req, res) => {
    if (hasLegacyPlaceId(req.body || {})) {
      res.status(422).json({ error: "placeId is deprecated. Use internalPlaceId/googlePlaceId.", traceId: req.traceId });
      return;
    }
    try {
      const upstream = await proxyToAiService({
        config,
        path: "/api/v2/recommend/videos",
        traceId: req.traceId,
        method: "POST",
        payload: req.body || {}
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 recommend unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.post("/recommend/jobs", requireAuth, async (req, res) => {
    if (hasLegacyPlaceId(req.body || {})) {
      res.status(422).json({ error: "placeId is deprecated. Use internalPlaceId/googlePlaceId.", traceId: req.traceId });
      return;
    }
    try {
      const upstream = await proxyToAiService({
        config,
        path: "/api/v2/recommend/jobs",
        traceId: req.traceId,
        method: "POST",
        payload: req.body || {}
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 recommend job unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.get("/recommend/jobs/:jobId", requireAuth, async (req, res) => {
    try {
      const upstream = await proxyToAiService({
        config,
        path: `/api/v2/recommend/jobs/${encodeURIComponent(req.params.jobId)}`,
        traceId: req.traceId,
        method: "GET"
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 recommend job unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.post("/trips/plan-from-intent", requireAuth, async (req, res) => {
    if (hasLegacyPlaceId(req.body || {})) {
      res.status(422).json({ error: "placeId is deprecated. Use internalPlaceId/googlePlaceId.", traceId: req.traceId });
      return;
    }
    try {
      const upstream = await proxyToAiService({
        config,
        path: "/api/v2/trips/plan-from-intent",
        traceId: req.traceId,
        method: "POST",
        payload: req.body || {}
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 trip planning unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.post("/trips/plan-jobs", requireAuth, async (req, res) => {
    if (hasLegacyPlaceId(req.body || {})) {
      res.status(422).json({ error: "placeId is deprecated. Use internalPlaceId/googlePlaceId.", traceId: req.traceId });
      return;
    }
    try {
      const upstream = await proxyToAiService({
        config,
        path: "/api/v2/trips/plan-jobs",
        traceId: req.traceId,
        method: "POST",
        payload: req.body || {}
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 trip job unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  router.get("/trips/plan-jobs/:jobId", requireAuth, async (req, res) => {
    try {
      const upstream = await proxyToAiService({
        config,
        path: `/api/v2/trips/plan-jobs/${encodeURIComponent(req.params.jobId)}`,
        traceId: req.traceId,
        method: "GET"
      });
      const data = normalizeV2ResponseData(upstream.data || {});
      data.traceId = data.traceId || req.traceId;
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(502).json({ error: "v2 trip job unavailable", traceId: req.traceId, detail: String(error) });
    }
  });

  // EventSource cannot reliably set Authorization headers cross-origin.
  // We support `accessToken` query parameter for SSE subscriptions.
  router.get("/jobs/:jobId/events", async (req, res) => {
    const user = authenticateSseRequest(req);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const kind = typeof req.query.kind === "string" ? req.query.kind.trim() : "";
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) {
      res.status(400).json({ error: "jobId required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("x-trace-id", req.traceId);
    res.write(`event: ready\ndata: ${JSON.stringify({ jobId, traceId: req.traceId, userId: user.id })}\n\n`);

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const poll = async () => {
      if (closed) {
        return;
      }
      try {
        const upstream = await fetchV2JobStatus({
          config,
          traceId: req.traceId,
          jobId,
          kind
        });
        const data = upstream.data || {};
        res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
        const status = String(data.status || "");
        if (!upstream.ok || status === "completed" || status === "failed") {
          res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
          res.end();
          return;
        }
      } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(error), traceId: req.traceId })}\n\n`);
      }
      setTimeout(() => {
        void poll();
      }, Math.max(500, config.v2JobPollIntervalMs || 1200));
    };

    void poll();
  });

  app.use("/api/v2", router);
}

export const __v2Internals = {
  generateTraceId,
  normalizeTraceId,
  parseIntOrNull,
  toNullableString,
  hasLegacyPlaceId,
  normalizeRenderableItem,
  normalizeV2ResponseData,
};
