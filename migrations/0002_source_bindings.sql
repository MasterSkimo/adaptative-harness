-- A source is explicitly bound to registered projects before event/context access.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS source_project_bindings (
  source_instance_id TEXT NOT NULL REFERENCES provider_instances(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_instance_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_recovery
  ON processing_jobs(status, lease_until, available_at);
INSERT OR IGNORE INTO schema_migrations(version, description, applied_at)
VALUES (2, 'Source and project authorization', '2026-11-03T00:00:00Z');
COMMIT;
