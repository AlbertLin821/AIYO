import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config();

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db",
  aiServiceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",
  aiServiceInternalToken: process.env.AI_SERVICE_INTERNAL_TOKEN || "",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4:e4b",
  redisUrl: process.env.REDIS_URL || "",
  jwtSecret: process.env.JWT_SECRET || "aiyo_dev_jwt_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "aiyo_dev_refresh_secret",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  refreshCookieName: (() => {
    const raw = process.env.REFRESH_COOKIE_NAME;
    if (!raw) return "aiyo_refresh_token";
    if (/^[a-zA-Z0-9_\-.]+$/.test(raw)) return raw;
    console.warn("[config] REFRESH_COOKIE_NAME contains invalid characters for a cookie name, using default 'aiyo_refresh_token'");
    return "aiyo_refresh_token";
  })(),
  enableGatewayMemoryExtract: String(process.env.ENABLE_GATEWAY_MEMORY_EXTRACT || "false").toLowerCase() === "true",
  sentryDsn: process.env.SENTRY_DSN || "",
  v1ReadonlyMode: String(process.env.V1_READONLY_MODE || "false").toLowerCase() === "true",
  v1ReadonlyExcludedPrefixes: (process.env.V1_READONLY_EXCLUDED_PREFIXES || "/api/v2,/api/auth,/api/dev,/health,/metrics")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  legacyFrontendPath: process.env.LEGACY_FRONTEND_PATH || "/legacy",
  v2JobPollIntervalMs: Math.max(500, Number(process.env.V2_JOB_POLL_INTERVAL_MS || 1200))
};
