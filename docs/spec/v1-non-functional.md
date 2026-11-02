# V1 non-functional requirements and SLO proposals

**Status:** Engineering targets to validate in Spike 0/benchmarks; not measured results.

| ID | Target | Verification |
|---|---|---|
| NFR-001 | No change in agent outcome or ability to complete when daemon is down | Kill daemon mid-turn and compare outcomes |
| NFR-002 | Observational hook local processing p95 under 15 ms, excluding provider own hook startup | 1,000 callback benchmark with instrumentation |
| NFR-003 | Context lookup hard deadline 100 ms (configurable), 0 extra context on timeout | Inject 200 ms latency and verify |
| NFR-004 | Event payload default max 64 KiB; reject oversize with explicit status | Boundary contract tests |
| NFR-005 | Spool bounded per adapter/user (default proposed 10 MiB or 5,000 events), expiry 24 hours | Overflow and expiry tests |
| NFR-006 | After crash/restart, accepted events not lost; processing at least once, effects idempotent | Power-failure simulation |
| NFR-007 | No unscoped memory returned in project context; no cross-project leakage | Isolation suite |
| NFR-008 | Every published artifact has content hash, provenance, evaluation evidence and rollback reference | Registry invariant checks |
| NFR-009 | No auto-publish of executable hook code, untrusted scripts or credential changes | Security negative tests |
| NFR-010 | No unauthenticated local data endpoint except metadata-free /health | HTTP authentication suite |
| NFR-011 | No network requests for ingestion, local search, publication or deterministic tests | Network-denied suite |
| NFR-012 | Single-user Windows 11 + Linux supported; WSL 2 treated as a separate environment by default | Cross-platform install/e2e |
| NFR-013 | Install/doctor/uninstall idempotent; preview before modifying user-owned files | File-system fixtures |
| NFR-014 | SQLite schema migrates from empty DB; repeated migration safe where specified | sqlite3 fixture test |
| NFR-015 | No tokens/cost charged for event collection; inference explicitly configured | Disabled-backend test |
| NFR-016 | Observed provider version+capability matrix stored per install | Connector doctor test |

## Data retention defaults (proposed)

- Normalized events: 30 days; evidence summaries referenced by published memories/releases retained while needed by those references.
- Bounded connector spool: 24 hours; no raw transcript content.
- Runtime metrics and redacted audit entries: 90 days; overridable by per-project policy.
- Published artifact revisions: retained until user-administered pruning, with active and rollback targets pinned.
- Per-project opt-out deletes future collection, with explicit removal/revocation flow for historical project data.

## Performance budget and graceful degradation

- Hooks perform only cheap deterministic redaction/encoding and bounded IPC; no LLM, Git operations or SQLite migration in a hook.
- Context injection respects strict maxItems/maxTokens and an absolute deadline; default targets: 5 entries/600 tokens.
- Daemon uses one writer queue and read transactions; long evaluations execute outside ingestion transactions.
- On queue saturation: preserve already accepted events, reject new events with a retryable status, and let connectors spool/drop without stopping agents.

## Quality metrics

Track eligible memory retrieval hit rate, correction recurrence, evaluations passed/failed, proposal promotion rate, rollback rate, duplicate event fraction, mean processing delay, p95 hook overhead, p95 context response, estimated inference tokens/cost, false-positive guard rate and per-project opt-out counts. Never equate cache hit rate with quality or approximate dollars with a real account invoice.

