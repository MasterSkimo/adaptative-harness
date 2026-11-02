# SQLite schema, persistence and recovery

SQL source of truth: [migrations/0001_init.sql](../../migrations/0001_init.sql).

## Deployment location

Per-user data root is configurable, with OS-specific defaults selected at implementation (e.g. XDG_STATE_HOME on Linux and LOCALAPPDATA on Windows). Keep SQLite, spool, credentials, artifacts and Git history in distinct subdirectories with user-only permissions. No database under T3/.t3 or an agent project.

## Schema aggregates

- `projects`, `project_roots`: opaque identities and verified workspace roots.
- `provider_instances`, `sessions`: actual runtime/profile/session and parent lineage.
- `events`: append-only canonical event envelopes, unique on producer ID+event ID.
- `processing_jobs`: durable work, idempotency keys, leases, retry/dead states.
- `evidence`: redacted references and hashes to observed outcomes.
- `memories`, `memory_evidence`, `memory_fts`: structured scoped knowledge and indexed retrieval.
- `artifacts`, `artifact_versions`, `proposals`, `evaluations`, `releases`, `publication_targets`: candidate lifecycle, immutable versions and install receipts.
- `inference_usage`, `audit_log`, `schema_migrations`: accountability and migrations.

## Database invariants

- PRAGMA foreign_keys=ON on every connection; journal_mode=WAL, busy_timeout=5000 set at startup (not inside migrations).
- Accept events in a short transaction; check producer+event ID deduplication. Response is 202 new or 200 exact duplicate.
- Store event `payload_json` as **sanitized** metadata only; never blindly persist original HTTP body.
- Event ingestion and creation of its initial processing job occur in the same transaction. Recovery scans for unmatched events to handle schema-era or external producer differences.
- Lease claim is a single write transaction that checks `status='queued'` or lease expiry. All consumers use compare-and-swap on lease owner and expiry.
- Proposal content and published artifact bytes are immutable and addressed by digest. A changed candidate creates a new proposal/version.
- Referential integrity cannot alone enforce cross-project scope; every service method must verify caller scope and entity ownership in the transaction.
- FTS triggers keep searchable summaries in sync. Ranking additionally filters active status and project/global permission outside the virtual table.

## Backup and restore

Use SQLite online backup API or VACUUM INTO while quiescing writes; never copy a live WAL database file alone. Back up manifest of artifact files and Git revision pointers at a consistent checkpoint. Restore validates hashes, schema version and release pointers before re-enabling publication. Retain a previous version during upgrades.

## Retention and deletions

Event retention 30 days is a proposal; eligible audit/evidence references pinned by published artifacts cannot be removed until those artifacts are retired. Sensitive project purge must remove project rows, attached evidence/snippets, spool entries, artifact materialization and related released content; define a backup deletion policy separately. Mark evidence references as orphaned only when historical releases explicitly tolerate redacted tombstones.

## Migration discipline

Monotonic numeric migrations, transactional where SQLite allows, no silent destructive downgrade. Test upgrade from an empty database and from previous supported schema snapshots. Every app version declares a supported schema range and refuses incompatible writes without touching agent processes.

