-- AIYO 愛遊 - 資料庫初始化腳本
-- 建立 pgvector 擴充
CREATE EXTENSION IF NOT EXISTS vector;

-- videos（影片表）
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  youtube_id VARCHAR(20) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  channel VARCHAR(255),
  duration INTEGER,
  view_count BIGINT,
  like_count BIGINT,
  city VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- segments（片段表）
-- 僅儲存時間戳、summary、tags、embedding，不儲存影片檔案或完整字幕原文
CREATE TABLE IF NOT EXISTS segments (
  id SERIAL PRIMARY KEY,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  start_sec INTEGER NOT NULL,
  end_sec INTEGER NOT NULL,
  summary TEXT,
  tags JSONB,
  city VARCHAR(100),
  embedding_vector vector(384),
  created_at TIMESTAMP DEFAULT NOW()
);

-- places（景點表）
CREATE TABLE IF NOT EXISTS places (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  category VARCHAR(50),
  description TEXT,
  city VARCHAR(100),
  embedding_vector vector(384),
  created_at TIMESTAMP DEFAULT NOW()
);

-- segment_places（片段-景點關聯表）
CREATE TABLE IF NOT EXISTS segment_places (
  segment_id INTEGER REFERENCES segments(id) ON DELETE CASCADE,
  place_id INTEGER REFERENCES places(id) ON DELETE CASCADE,
  PRIMARY KEY (segment_id, place_id)
);

-- 一般索引
CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_id);
CREATE INDEX IF NOT EXISTS idx_videos_city ON videos(city);
CREATE INDEX IF NOT EXISTS idx_segments_video_id ON segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_city ON segments(city);
CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);
CREATE INDEX IF NOT EXISTS idx_places_city ON places(city);
CREATE INDEX IF NOT EXISTS idx_segment_places_segment_id ON segment_places(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_places_place_id ON segment_places(place_id);

-- 向量索引（需在資料寫入後建立，建議資料量 > 1000 時使用 ivfflat）
-- 開發階段可先使用 flat 索引或省略，大量資料時再建立
-- CREATE INDEX idx_segments_embedding ON segments USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_places_embedding ON places USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);

-- 建立向量索引（使用 HNSW，較適合小至中規模資料）
CREATE INDEX IF NOT EXISTS idx_segments_embedding ON segments
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_embedding ON places
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

-- itineraries（行程主表，對應 migration 002）
CREATE TABLE IF NOT EXISTS itineraries (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  days_count INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itinerary_days (
  id SERIAL PRIMARY KEY,
  itinerary_id INTEGER REFERENCES itineraries(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  date_label VARCHAR(50)
);

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
