-- Migration 002: 行程相關表（itineraries）
-- 對應 SRS 第 7 節 API 設計與第 5 節行程規劃結構
-- 需在 001_initial_schema 執行後執行

-- itineraries（行程主表）
CREATE TABLE IF NOT EXISTS itineraries (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  days_count INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- itinerary_days（行程天數）
CREATE TABLE IF NOT EXISTS itinerary_days (
  id SERIAL PRIMARY KEY,
  itinerary_id INTEGER REFERENCES itineraries(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  date_label VARCHAR(50)
);

-- itinerary_slots（行程時段，對應 SRS 的 slot 結構）
CREATE TABLE IF NOT EXISTS itinerary_slots (
  id SERIAL PRIMARY KEY,
  day_id INTEGER REFERENCES itinerary_days(id) ON DELETE CASCADE,
  time_range_start TIME,
  time_range_end TIME,
  place_name VARCHAR(255) NOT NULL,
  place_id INTEGER REFERENCES places(id),
  segment_id INTEGER REFERENCES segments(id),
  slot_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_itineraries_session_id ON itineraries(session_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_days_itinerary_id ON itinerary_days(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_slots_day_id ON itinerary_slots(day_id);
