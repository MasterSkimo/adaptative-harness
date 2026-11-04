-- OpenCode 2 conversations outlive individual executions.
-- The latest execution state is persisted independently of session closure.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS session_execution_state (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled','unknown')),
  started_at TEXT,
  finished_at TEXT,
  event_sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_execution_status
  ON session_execution_state(status,updated_at);
INSERT OR IGNORE INTO schema_migrations(version,description,applied_at)
VALUES (4,'Persist execution lifecycle separately from conversation session','2026-11-04T00:00:00Z');
COMMIT;
