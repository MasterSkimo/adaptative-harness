-- Provider-reported token and cost usage for a conversation.
-- OpenCode publishes cumulative per-session snapshots, so the latest observed
-- snapshot replaces the previous one instead of being summed.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS session_usage (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0),
  event_sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_usage_updated
  ON session_usage(updated_at);
INSERT OR IGNORE INTO schema_migrations(version,description,applied_at)
VALUES (5,'Persist provider-reported session token usage','2026-11-04T00:00:00Z');
COMMIT;
