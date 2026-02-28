import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { pool } from "../src/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const gatewayBaseUrl = (process.env.API_GATEWAY_URL || "http://localhost:3001").replace(/\/$/, "");
const evalEmail = process.env.OFFLINE_EVAL_EMAIL || `offline_eval_${Date.now()}@example.com`;
const evalPassword = process.env.OFFLINE_EVAL_PASSWORD || "pass1234";
const datasetPath = process.env.OFFLINE_EVAL_DATASET
  ? path.resolve(process.cwd(), process.env.OFFLINE_EVAL_DATASET)
  : path.join(repoRoot, "benchmark", "offline_golden_set.json");
const shouldPersist = String(process.env.OFFLINE_EVAL_PERSIST || "true").toLowerCase() !== "false";
const timeoutMs = Number(process.env.OFFLINE_EVAL_TIMEOUT_MS || 25000);

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function httpJson(method, endpointPath, body, token) {
  const url = `${gatewayBaseUrl}${endpointPath}`;
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return { ok: response.ok, status: response.status, payload };
}

async function registerOrLogin() {
  const registerResult = await httpJson("POST", "/api/auth/register", {
    email: evalEmail,
    password: evalPassword,
  });
  if (registerResult.ok) {
    const token = registerResult.payload?.access_token || registerResult.payload?.token || "";
    if (token) {
      return token;
    }
  }
  if (registerResult.status !== 409) {
    throw new Error(`register failed: status=${registerResult.status}`);
  }
  const loginResult = await httpJson("POST", "/api/auth/login", {
    email: evalEmail,
    password: evalPassword,
  });
  if (!loginResult.ok) {
    throw new Error(`login failed: status=${loginResult.status}`);
  }
  const token = loginResult.payload?.access_token || loginResult.payload?.token || "";
  if (!token) {
    throw new Error("login returned empty token");
  }
  return token;
}

function buildTextBlob(chatPayload) {
  const reply = String(chatPayload?.reply || "");
  const videos = Array.isArray(chatPayload?.recommended_videos) ? chatPayload.recommended_videos : [];
  const videoText = videos
    .map((v) => {
      const reasons = Array.isArray(v?.recommendation_reasons) ? v.recommendation_reasons.join(" ") : "";
      return [v?.title || "", v?.summary || "", v?.city || "", reasons].join(" ");
    })
    .join(" ");
  return `${reply} ${videoText}`.toLowerCase();
}

function evaluateCase(caseDef, chatPayload) {
  const expectedKeywords = Array.isArray(caseDef.expected_keywords) ? caseDef.expected_keywords : [];
  const minKeywordHits = Number(caseDef.min_keyword_hits || 0);
  const blob = buildTextBlob(chatPayload);
  const keywordHits = expectedKeywords.filter((kw) => kw && blob.includes(String(kw).toLowerCase())).length;
  const keywordPass = keywordHits >= minKeywordHits;

  const minRecs = Number(caseDef.min_recommendations || 0);
  const recs = Array.isArray(chatPayload?.recommended_videos) ? chatPayload.recommended_videos : [];
  const recommendationPass = recs.length >= minRecs;

  const expectedTool = String(caseDef.expected_tool || "").trim();
  const toolSummary = Array.isArray(chatPayload?.tool_calls_summary) ? chatPayload.tool_calls_summary : [];
  const toolPass = expectedTool
    ? toolSummary.some((t) => t?.tool === expectedTool && t?.ok === true)
    : true;

  const pass = keywordPass && recommendationPass && toolPass;
  return {
    pass,
    keyword_hits: keywordHits,
    keyword_pass: keywordPass,
    recommendation_count: recs.length,
    recommendation_pass: recommendationPass,
    expected_tool: expectedTool || null,
    tool_pass: toolPass,
  };
}

function computeRates(caseResults) {
  const total = caseResults.length || 1;
  const passCount = caseResults.filter((r) => r.evaluation.pass).length;
  const byCategory = new Map();
  let toolExpectedCases = 0;
  let toolPassCases = 0;

  for (const item of caseResults) {
    const category = item.case.category || "uncategorized";
    if (!byCategory.has(category)) {
      byCategory.set(category, { total: 0, pass: 0 });
    }
    const bucket = byCategory.get(category);
    bucket.total += 1;
    if (item.evaluation.pass) {
      bucket.pass += 1;
    }
    if (item.evaluation.expected_tool) {
      toolExpectedCases += 1;
      if (item.evaluation.tool_pass) {
        toolPassCases += 1;
      }
    }
  }

  const metrics = [
    {
      metric_name: "offline_eval.overall_pass_rate",
      metric_value: Number((passCount / total).toFixed(4)),
      sample_count: caseResults.length,
    },
    {
      metric_name: "offline_eval.tool_expected_success_rate",
      metric_value: Number((toolExpectedCases > 0 ? toolPassCases / toolExpectedCases : 1).toFixed(4)),
      sample_count: toolExpectedCases,
    },
  ];

  for (const [category, value] of byCategory.entries()) {
    metrics.push({
      metric_name: `offline_eval.${category}.pass_rate`,
      metric_value: Number((value.total > 0 ? value.pass / value.total : 0).toFixed(4)),
      sample_count: value.total,
    });
  }
  return metrics;
}

async function persistBaselines(metrics, notes) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quality_baselines (
      id SERIAL PRIMARY KEY,
      metric_name VARCHAR(100) NOT NULL,
      metric_value NUMERIC(10,4) NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quality_baselines_metric
    ON quality_baselines(metric_name, measured_at DESC)
  `);
  for (const metric of metrics) {
    await pool.query(
      `
      INSERT INTO quality_baselines (metric_name, metric_value, sample_count, notes)
      VALUES ($1, $2, $3, $4)
      `,
      [metric.metric_name, metric.metric_value, metric.sample_count, notes]
    );
  }
}

async function main() {
  const runId = `offline-baseline-${nowIsoCompact()}`;
  const reportDir = path.join(repoRoot, "benchmark", "reports");
  await fs.mkdir(reportDir, { recursive: true });

  const rawDataset = await fs.readFile(datasetPath, "utf-8");
  const goldenSet = JSON.parse(rawDataset);
  if (!Array.isArray(goldenSet) || goldenSet.length === 0) {
    throw new Error("golden set is empty");
  }

  const token = await registerOrLogin();
  const caseResults = [];

  for (const caseDef of goldenSet) {
    const payload = {
      sessionId: `${runId}-${caseDef.id || "case"}`,
      message: String(caseDef.message || ""),
      messages: [],
      stream: false,
      city: caseDef.city || undefined,
    };
    const chatResult = await httpJson("POST", "/api/chat", payload, token);
    if (!chatResult.ok) {
      caseResults.push({
        case: caseDef,
        evaluation: {
          pass: false,
          keyword_hits: 0,
          keyword_pass: false,
          recommendation_count: 0,
          recommendation_pass: false,
          expected_tool: caseDef.expected_tool || null,
          tool_pass: false,
        },
        error: `chat failed: status=${chatResult.status}`,
      });
      continue;
    }
    caseResults.push({
      case: caseDef,
      evaluation: evaluateCase(caseDef, chatResult.payload),
      response: {
        reply: chatResult.payload?.reply || "",
        recommended_videos_count: Array.isArray(chatResult.payload?.recommended_videos)
          ? chatResult.payload.recommended_videos.length
          : 0,
        tool_calls_summary: chatResult.payload?.tool_calls_summary || [],
      },
    });
  }

  const metrics = computeRates(caseResults);
  const notes = `run_id=${runId}; dataset=${path.relative(repoRoot, datasetPath)}`;

  if (shouldPersist) {
    await persistBaselines(metrics, notes);
  }

  const report = {
    run_id: runId,
    measured_at: new Date().toISOString(),
    gateway_base_url: gatewayBaseUrl,
    dataset_path: path.relative(repoRoot, datasetPath),
    persisted_to_db: shouldPersist,
    metrics,
    results: caseResults,
  };

  const reportPath = path.join(reportDir, `${runId}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(JSON.stringify({
    ok: true,
    run_id: runId,
    cases: caseResults.length,
    report_path: path.relative(repoRoot, reportPath),
    metrics,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[offline-baseline] failed:", error?.message || String(error));
    if (error?.cause) {
      console.error("[offline-baseline] cause:", error.cause);
    }
    if (error?.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
