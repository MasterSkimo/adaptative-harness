# ADR-0004 — SQLite event store, FTS5 and versioned assets

**Status:** Accepted · 2026-11-02

## Decision

One SQLite database in a user-private data directory with WAL, foreign keys and a busy timeout; single daemon writer. Use a durable SQLite job queue and FTS5/BM25 for retrieval. Store immutable published asset content in versioned files; mirror release history to a Harness-owned Git repository.

## Alternatives

- PostgreSQL/Redis: operational requirements disproportionate for local V1.
- SQLite vector extension from day one: no measured retrieval benefit; complicates portability and packaging.
- Store everything in Git: poor indexing, transactions and deduplication.
- Use T3 SQLite: migration conflicts and lifecycle coupling.

## Consequences

Define backups, retention and schema migrations. Enforce cross-table project scope in application transactions, since foreign keys alone cannot express all access-control rules. Do not persist raw transcripts by default. A retrieval benchmark can justify embeddings in a later ADR.

