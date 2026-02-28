import fs from "node:fs";
import path from "node:path";

const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = (targetArg ? targetArg.split("=")[1] : "all").toLowerCase();

const REQUIRED_BY_TARGET = {
  all: [
    "DATABASE_URL",
    "REDIS_URL",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "AI_SERVICE_INTERNAL_TOKEN",
    "YOUTUBE_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "AI_SERVICE_URL",
    "NEXT_PUBLIC_API_BASE_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  ],
  ai: [
    "DATABASE_URL",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "AI_SERVICE_INTERNAL_TOKEN",
    "YOUTUBE_API_KEY",
    "GOOGLE_MAPS_API_KEY",
  ],
  gateway: [
    "DATABASE_URL",
    "REDIS_URL",
    "AI_SERVICE_URL",
    "AI_SERVICE_INTERNAL_TOKEN",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
  ],
  frontend: ["NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"],
};

const PLACEHOLDER_PATTERNS = [
  /^your_/i,
  /^replace_with_/i,
  /^changeme$/i,
  /^example$/i,
];

function parseEnvFile(content) {
  const map = new Map();
  content.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith("#")) return;
    const idx = text.indexOf("=");
    if (idx <= 0) return;
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    map.set(key, value);
  });
  return map;
}

function valueLooksPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function readLocalEnvFallback() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return new Map();
  return parseEnvFile(fs.readFileSync(envPath, "utf-8"));
}

function main() {
  if (!REQUIRED_BY_TARGET[target]) {
    console.error(`[env-validate] invalid target: ${target}`);
    process.exit(1);
  }

  const required = REQUIRED_BY_TARGET[target];
  const localEnv = readLocalEnvFallback();
  const missing = [];
  const placeholders = [];

  for (const key of required) {
    const value = process.env[key] ?? localEnv.get(key) ?? "";
    if (!String(value).trim()) {
      missing.push(key);
      continue;
    }
    if (valueLooksPlaceholder(String(value).trim())) {
      placeholders.push(key);
    }
  }

  console.log(`[env-validate] target=${target}`);
  if (missing.length === 0 && placeholders.length === 0) {
    console.log("[env-validate] all required variables look ready");
    return;
  }
  if (missing.length > 0) {
    console.log(`[env-validate] missing: ${missing.join(", ")}`);
  }
  if (placeholders.length > 0) {
    console.log(`[env-validate] placeholder values: ${placeholders.join(", ")}`);
  }
  process.exitCode = 1;
}

main();
