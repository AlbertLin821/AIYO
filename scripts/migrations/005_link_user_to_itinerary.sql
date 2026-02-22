-- Migration 005: 將 itineraries 掛上 user_id（保留 session_id 相容）

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'itineraries'
  ) THEN
    ALTER TABLE itineraries
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_itineraries_user_id ON itineraries(user_id);
  END IF;
END $$;
