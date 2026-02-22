-- Migration 006: 影片處理去重與快取索引

CREATE TABLE IF NOT EXISTS video_processing_cache (
  id SERIAL PRIMARY KEY,
  youtube_id VARCHAR(20) NOT NULL,
  processor_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  status VARCHAR(30) NOT NULL DEFAULT 'ready',
  processed_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE (youtube_id, processor_version)
);

CREATE INDEX IF NOT EXISTS idx_video_processing_cache_youtube_id ON video_processing_cache(youtube_id);
