import { pool } from "../src/db.js";

const windows = [7, 30];
const weeklyTrendWindow = 8;

async function ensureQualityBaselinesTable() {
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
}

async function ensureRecommendationEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recommendation_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      session_id VARCHAR(255),
      event_type VARCHAR(50) NOT NULL,
      query_text TEXT,
      query_intent VARCHAR(100),
      tool_source VARCHAR(100),
      video_id INTEGER,
      segment_id INTEGER,
      youtube_id VARCHAR(20),
      rank_position INTEGER,
      rank_score NUMERIC(8,4),
      recommendation_reason TEXT,
      location_source VARCHAR(50),
      personalization_signals JSONB DEFAULT '{}'::jsonb,
      feedback_action VARCHAR(50),
      dwell_time_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rec_events_event_type
    ON recommendation_events(event_type)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rec_events_created_at
    ON recommendation_events(created_at DESC)
  `);
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

async function computeWindowMetrics(days) {
  const result = await pool.query(
    `
    WITH event_counts AS (
      SELECT
        event_type,
        COUNT(*)::int AS count
      FROM recommendation_events
      WHERE created_at >= NOW() - make_interval(days => $1)
      GROUP BY event_type
    ),
    totals AS (
      SELECT
        COALESCE(SUM(count), 0)::int AS total_events
      FROM event_counts
    ),
    users AS (
      SELECT COUNT(DISTINCT user_id)::int AS unique_users
      FROM recommendation_events
      WHERE created_at >= NOW() - make_interval(days => $1)
        AND user_id IS NOT NULL
    )
    SELECT
      (SELECT count FROM event_counts WHERE event_type = 'impression') AS impressions,
      (SELECT count FROM event_counts WHERE event_type = 'click') AS clicks,
      (SELECT count FROM event_counts WHERE event_type = 'segment_jump') AS segment_jumps,
      (SELECT count FROM event_counts WHERE event_type = 'itinerary_adopt') AS itinerary_adopts,
      (SELECT count FROM event_counts WHERE event_type = 'dismiss') AS dismisses,
      (SELECT total_events FROM totals) AS total_events,
      (SELECT unique_users FROM users) AS unique_users
    `,
    [days]
  );
  const row = result.rows[0] || {};
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const segmentJumps = Number(row.segment_jumps || 0);
  const itineraryAdopts = Number(row.itinerary_adopts || 0);
  const dismisses = Number(row.dismisses || 0);
  const totalEvents = Number(row.total_events || 0);
  const uniqueUsers = Number(row.unique_users || 0);

  const ctr = impressions > 0 ? clicks / impressions : 0;
  const segmentJumpRate = impressions > 0 ? segmentJumps / impressions : 0;
  const adoptRate = impressions > 0 ? itineraryAdopts / impressions : 0;
  const dismissRate = impressions > 0 ? dismisses / impressions : 0;

  return {
    days,
    impressions,
    clicks,
    segmentJumps,
    itineraryAdopts,
    dismisses,
    totalEvents,
    uniqueUsers,
    ctr: round4(ctr),
    segmentJumpRate: round4(segmentJumpRate),
    adoptRate: round4(adoptRate),
    dismissRate: round4(dismissRate),
  };
}

async function insertMetric(metricName, metricValue, sampleCount, notes) {
  await pool.query(
    `
    INSERT INTO quality_baselines (metric_name, metric_value, sample_count, notes)
    VALUES ($1, $2, $3, $4)
    `,
    [metricName, metricValue, sampleCount, notes]
  );
}

async function computeWeeklyCtrTrend(weeks = 8) {
  const safeWeeks = Math.min(26, Math.max(2, Number(weeks) || 8));
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
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
      FROM recommendation_events
      WHERE created_at >= date_trunc('week', NOW()) - (($1 - 1) * INTERVAL '1 week')
      GROUP BY 1
    )
    SELECT
      ws.week_start,
      COALESCE(agg.impressions, 0)::int AS impressions,
      COALESCE(agg.clicks, 0)::int AS clicks
    FROM week_series ws
    LEFT JOIN agg ON agg.week_start = ws.week_start
    ORDER BY ws.week_start ASC
    `,
    [safeWeeks]
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
      ctr,
      wow_ctr_change: wow
    });
    previousCtr = ctr;
  }
  return weekly;
}

async function main() {
  await ensureRecommendationEventsTable();
  await ensureQualityBaselinesTable();
  const timestamp = new Date().toISOString();
  const output = [];

  for (const days of windows) {
    const metrics = await computeWindowMetrics(days);
    const notes = `window_days=${days}; generated_at=${timestamp}`;

    await insertMetric(`recommendation.ctr.${days}d`, metrics.ctr, metrics.impressions, notes);
    await insertMetric(`recommendation.segment_jump_rate.${days}d`, metrics.segmentJumpRate, metrics.impressions, notes);
    await insertMetric(`recommendation.adopt_rate.${days}d`, metrics.adoptRate, metrics.impressions, notes);
    await insertMetric(`recommendation.dismiss_rate.${days}d`, metrics.dismissRate, metrics.impressions, notes);
    await insertMetric(`recommendation.unique_users.${days}d`, metrics.uniqueUsers, metrics.uniqueUsers, notes);
    await insertMetric(`recommendation.total_events.${days}d`, metrics.totalEvents, metrics.totalEvents, notes);

    output.push(metrics);
  }

  const weeklyCtr = await computeWeeklyCtrTrend(weeklyTrendWindow);
  for (const row of weeklyCtr) {
    const noteBase = `week_start=${row.week_start}; generated_at=${timestamp}`;
    await insertMetric("recommendation.ctr.weekly", row.ctr, row.impressions, noteBase);
    if (typeof row.wow_ctr_change === "number") {
      await insertMetric("recommendation.ctr.wow_weekly", row.wow_ctr_change, row.impressions, noteBase);
    }
  }

  console.log(JSON.stringify({ ok: true, generated_at: timestamp, windows: output, weekly_ctr: weeklyCtr }, null, 2));
}

main()
  .catch((error) => {
    console.error("[recompute-recommendation-baselines] failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
