-- Migration 014: AIYO V2 core schema (isolated namespace)
-- Notes:
-- - Uses schema `v2` to avoid conflicts with existing V1 tables.
-- - Embedding contract is explicitly versioned (model_name/model_version/dim).
-- - Geocode status is explicit for UI/plan fallback rules.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS v2;

-- ---------------------------------------------------------------------------
-- Auth / users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v2.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS v2.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS v2.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES v2.users(id) ON DELETE CASCADE,
  display_name VARCHAR(120),
  budget_pref VARCHAR(80),
  pace_pref VARCHAR(80),
  transport_pref VARCHAR(80),
  dietary_pref VARCHAR(120),
  preferred_cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.user_ai_preferences (
  user_id UUID PRIMARY KEY REFERENCES v2.users(id) ON DELETE CASCADE,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  weather_default_region VARCHAR(120),
  auto_use_current_location BOOLEAN NOT NULL DEFAULT TRUE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_region VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_user_sessions_user_id ON v2.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_v2_user_sessions_expires_at ON v2.user_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Content graph
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v2.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id VARCHAR(20) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  channel VARCHAR(255),
  duration INTEGER,
  city VARCHAR(100),
  stats_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.youtube_stats_cache (
  youtube_id VARCHAR(20) PRIMARY KEY,
  view_count BIGINT,
  like_count BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(50) NOT NULL DEFAULT 'cache'
);

CREATE TABLE IF NOT EXISTS v2.video_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES v2.videos(id) ON DELETE CASCADE,
  start_sec INTEGER NOT NULL,
  end_sec INTEGER NOT NULL,
  summary TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  city VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  country VARCHAR(100),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  google_place_id VARCHAR(255),
  category VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.segment_places (
  segment_id UUID NOT NULL REFERENCES v2.video_segments(id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES v2.places(id) ON DELETE CASCADE,
  geocode_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (geocode_status IN ('ok', 'failed', 'pending')),
  geocode_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (geocode_retry_count >= 0),
  last_geocode_attempt_at TIMESTAMPTZ,
  geocode_confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (segment_id, place_id)
);

CREATE TABLE IF NOT EXISTS v2.segment_embeddings (
  segment_id UUID NOT NULL REFERENCES v2.video_segments(id) ON DELETE CASCADE,
  model_name VARCHAR(120) NOT NULL,
  model_version VARCHAR(40) NOT NULL DEFAULT '1',
  dim INTEGER NOT NULL CHECK (dim > 0),
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (vector_dims(embedding) = dim),
  PRIMARY KEY (segment_id, model_name, model_version)
);

CREATE TABLE IF NOT EXISTS v2.user_embeddings (
  user_id UUID NOT NULL REFERENCES v2.users(id) ON DELETE CASCADE,
  model_name VARCHAR(120) NOT NULL,
  model_version VARCHAR(40) NOT NULL DEFAULT '1',
  dim INTEGER NOT NULL CHECK (dim > 0),
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (vector_dims(embedding) = dim),
  PRIMARY KEY (user_id, model_name, model_version)
);

CREATE INDEX IF NOT EXISTS idx_v2_videos_youtube_id ON v2.videos(youtube_id);
CREATE INDEX IF NOT EXISTS idx_v2_video_segments_video_id ON v2.video_segments(video_id);
CREATE INDEX IF NOT EXISTS idx_v2_video_segments_city ON v2.video_segments(city);
CREATE INDEX IF NOT EXISTS idx_v2_places_city ON v2.places(city);
CREATE INDEX IF NOT EXISTS idx_v2_places_google_place_id ON v2.places(google_place_id);
CREATE INDEX IF NOT EXISTS idx_v2_segment_places_geocode_retry
  ON v2.segment_places(geocode_status, geocode_retry_count);
CREATE INDEX IF NOT EXISTS idx_v2_segment_embeddings_vec_p1_nomic ON v2.segment_embeddings
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE model_name = 'nomic-embed-text' AND dim = 768;
CREATE INDEX IF NOT EXISTS idx_v2_user_embeddings_vec_p1_nomic ON v2.user_embeddings
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE model_name = 'nomic-embed-text' AND dim = 768;

-- ---------------------------------------------------------------------------
-- Trip planning
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v2.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES v2.users(id) ON DELETE CASCADE,
  destination VARCHAR(120),
  title VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  days_count INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.trip_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES v2.trips(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  date_label VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, day_number)
);

CREATE TABLE IF NOT EXISTS v2.trip_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_day_id UUID NOT NULL REFERENCES v2.trip_days(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL,
  internal_place_id UUID REFERENCES v2.places(id) ON DELETE SET NULL,
  manual_place_name VARCHAR(255),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  travel_mode VARCHAR(30),
  travel_minutes_from_prev INTEGER,
  start_time VARCHAR(10),
  end_time VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.trip_stop_segments (
  trip_stop_id UUID NOT NULL REFERENCES v2.trip_stops(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES v2.video_segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_stop_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_trips_user_id ON v2.trips(user_id);
CREATE INDEX IF NOT EXISTS idx_v2_trip_days_trip_id ON v2.trip_days(trip_id);
CREATE INDEX IF NOT EXISTS idx_v2_trip_stops_day_id ON v2.trip_stops(trip_day_id);

-- ---------------------------------------------------------------------------
-- Observability / jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v2.recommendation_events (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(64),
  user_id UUID REFERENCES v2.users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  youtube_id VARCHAR(20),
  segment_id UUID,
  internal_place_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.voice_intent_logs (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(64) NOT NULL,
  user_id UUID REFERENCES v2.users(id) ON DELETE SET NULL,
  input_text TEXT NOT NULL,
  parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.planner_runs (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(64) NOT NULL,
  user_id UUID REFERENCES v2.users(id) ON DELETE SET NULL,
  intent_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2.pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_reco_events_trace_id ON v2.recommendation_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_v2_voice_logs_trace_id ON v2.voice_intent_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_v2_planner_runs_trace_id ON v2.planner_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_v2_pipeline_jobs_status ON v2.pipeline_jobs(status);
