-- Migration 007: chat_sessions 外部 session id 關聯

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS external_session_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_user_external
  ON chat_sessions(user_id, external_session_id)
  WHERE external_session_id IS NOT NULL;
