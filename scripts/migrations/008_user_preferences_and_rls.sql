-- Migration 008: user_preferences 向量記憶與 RLS 隔離

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding_vector vector(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON user_preferences(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_preferences_embedding
  ON user_preferences USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding_vector IS NOT NULL;

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_preferences'
      AND policyname = 'user_isolation'
  ) THEN
    CREATE POLICY user_isolation
      ON user_preferences
      USING (user_id = NULLIF(current_setting('app.user_id', true), '')::INT)
      WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::INT);
  END IF;
END $$;
