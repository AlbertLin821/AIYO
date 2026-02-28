-- Migration 010: 開發者後台稽核表與登入事件

CREATE TABLE IF NOT EXISTS developer_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(64),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  endpoint VARCHAR(255),
  method VARCHAR(10),
  status_code INTEGER,
  request_json JSONB DEFAULT '{}'::jsonb,
  response_json JSONB DEFAULT '{}'::jsonb,
  ai_prompt_json JSONB DEFAULT '{}'::jsonb,
  ai_response_json JSONB DEFAULT '{}'::jsonb,
  tool_calls_json JSONB DEFAULT '[]'::jsonb,
  error_text TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_trace_id ON developer_audit_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON developer_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint ON developer_audit_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON developer_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS developer_login_events (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_login_events_email ON developer_login_events(email);
CREATE INDEX IF NOT EXISTS idx_dev_login_events_created_at ON developer_login_events(created_at DESC);
