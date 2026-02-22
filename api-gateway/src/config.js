import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db",
  aiServiceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3:8b",
  redisUrl: process.env.REDIS_URL || "",
  jwtSecret: process.env.JWT_SECRET || "aiyo_dev_jwt_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d"
};
