-- Migration 011: 推薦事件追蹤與品質基線量測

CREATE TABLE IF NOT EXISTS recommendation_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255),
  event_type VARCHAR(50) NOT NULL,
  query_text TEXT,
  query_intent VARCHAR(100),
  tool_source VARCHAR(100),
  video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  segment_id INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  youtube_id VARCHAR(20),
  rank_position INTEGER,
  rank_score NUMERIC(8,4),
  recommendation_reason TEXT,
  location_source VARCHAR(50),
  personalization_signals JSONB DEFAULT '{}'::jsonb,
  feedback_action VARCHAR(50),
  dwell_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_events_user_id ON recommendation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_event_type ON recommendation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rec_events_created_at ON recommendation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_events_session ON recommendation_events(session_id);

COMMENT ON TABLE recommendation_events IS '追蹤推薦曝光、點擊、採納事件，用於計算推薦品質基線';
COMMENT ON COLUMN recommendation_events.event_type IS 'impression / click / segment_jump / itinerary_adopt / dismiss';
COMMENT ON COLUMN recommendation_events.query_intent IS 'weather / city_recommend / itinerary / video_search / general';
COMMENT ON COLUMN recommendation_events.tool_source IS 'db_rag / youtube_api / weather_api / travel_info / transport';
COMMENT ON COLUMN recommendation_events.location_source IS 'tool_argument / current_region / reverse_geocode / weather_default_region / default_region / none';

CREATE TABLE IF NOT EXISTS quality_baselines (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC(10,4) NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_baselines_metric ON quality_baselines(metric_name, measured_at DESC);

COMMENT ON TABLE quality_baselines IS '品質基線量測快照，記錄各指標隨時間變化';
