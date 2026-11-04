-- Provenance links are immutable and scoped before evaluation/promotion.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS proposal_evidence (
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  PRIMARY KEY (proposal_id,evidence_id)
);
INSERT OR IGNORE INTO schema_migrations(version,description,applied_at)
VALUES (3,'Immutable proposal evidence provenance','2026-11-03T00:00:00Z');
COMMIT;
