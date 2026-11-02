BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS source_project_bindings (
  source_instance_id TEXT PRIMARY KEY REFERENCES provider_instances(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(source_instance_id, project_id)
);
INSERT OR IGNORE INTO schema_migrations(version,description,applied_at)
VALUES(2,'Bind source instances to projects','2026-11-02T00:00:00Z');
PRAGMA user_version=2;
COMMIT;
