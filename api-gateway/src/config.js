import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db",
  aiServiceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",
  aiServiceInternalToken: process.env.AI_SERVICE_INTERNAL_TOKEN || "",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3:8b",
  redisUrl: process.env.REDIS_URL || "",
  jwtSecret: process.env.JWT_SECRET || "aiyo_dev_jwt_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "aiyo_dev_refresh_secret",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || "aiyo_refresh_token",
  enableGatewayMemoryExtract: String(process.env.ENABLE_GATEWAY_MEMORY_EXTRACT || "false").toLowerCase() === "true",
  sentryDsn: process.env.SENTRY_DSN || ""
};
