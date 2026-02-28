import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const migrationsDir = path.resolve(repoRoot, "scripts", "migrations");
const databaseUrl = process.env.DATABASE_URL || "postgresql://aiyo:aiyo_password@localhost:5432/aiyo_db";
const dryRun = process.argv.includes("--dry-run");

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function run() {
  const files = await listMigrationFiles();
  if (files.length === 0) {
    throw new Error(`no migration files found in ${migrationsDir}`);
  }

  console.log(`[migrate] target database: ${databaseUrl}`);
  console.log(`[migrate] files (${files.length}): ${files.join(", ")}`);
  if (dryRun) {
    console.log("[migrate] dry-run mode, no SQL executed");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, "utf-8");
      console.log(`[migrate] applying ${file}`);
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
    }
    console.log("[migrate] all migrations applied successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[migrate] failed:", error?.message || String(error));
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => {
  process.exitCode = 1;
});
