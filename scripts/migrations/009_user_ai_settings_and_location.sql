-- Migration 009: 可配置 AI 工具策略與使用者當前地區

CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tool_policy_json JSONB NOT NULL DEFAULT '{
    "enabled": true,
    "weather_use_current_location": true,
    "tool_trigger_rules": "遇到即時資訊問題（天氣、營業時間、交通、票價、活動）時優先查工具。"
  }'::jsonb,
  weather_default_region VARCHAR(120),
  auto_use_current_location BOOLEAN NOT NULL DEFAULT TRUE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_region VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_settings_updated_at
  ON user_ai_settings(updated_at DESC);
