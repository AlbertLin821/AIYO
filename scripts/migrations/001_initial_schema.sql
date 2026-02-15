-- Migration 001: 初始 Schema
-- 用於已存在之資料庫的手動遷移
-- 若使用 Docker 首次啟動，init-db.sql 已會自動執行，此檔僅供參考或手動遷移使用

CREATE EXTENSION IF NOT EXISTS vector;

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

CREATE TABLE IF NOT EXISTS segment_places (
  segment_id INTEGER REFERENCES segments(id) ON DELETE CASCADE,
  place_id INTEGER REFERENCES places(id) ON DELETE CASCADE,
  PRIMARY KEY (segment_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_id);
CREATE INDEX IF NOT EXISTS idx_videos_city ON videos(city);
CREATE INDEX IF NOT EXISTS idx_segments_video_id ON segments(video_id);
CREATE INDEX IF NOT EXISTS idx_segments_city ON segments(city);
CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);
CREATE INDEX IF NOT EXISTS idx_places_city ON places(city);
CREATE INDEX IF NOT EXISTS idx_segment_places_segment_id ON segment_places(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_places_place_id ON segment_places(place_id);

-- 向量索引（與 init-db.sql 一致；pgvector HNSW 較適合資料持續變動的情境）
CREATE INDEX IF NOT EXISTS idx_segments_embedding ON segments
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_embedding ON places
  USING hnsw (embedding_vector vector_cosine_ops)
  WHERE embedding_vector IS NOT NULL;
