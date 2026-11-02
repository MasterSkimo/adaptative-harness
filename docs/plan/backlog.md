# Ordered implementation backlog

**Rule:** every item must link to its test IDs, accepted ADRs and measured results. Do not build the full engine before Spike 0 is proven.

## S0 — Connectivity (blocking)

- [ ] S0-01: Capture provider runtime versions, effective homes/config resolution, user scope and T3 commit (AT-002).
- [ ] S0-02: Build reversible synthetic Codex observer; test direct CLI + T3 App Server (AT-001/005/006).
- [ ] S0-03: Build reversible native OpenCode **2.x** plugin; test direct CLI + T3 server (AT-001/005/007).
- [ ] S0-04: Capture before/after, child lineage and context capability matrix, including unavailable events (AT-002/005/006/007).
- [ ] S0-05: Kill observer during agent call; verify fail-open and bounded overhead (AT-008/021).
- [ ] S0-06: Repeat on Windows native and Linux; decide GO/NO-GO, publish replay fixtures, update ADR as needed (AT-020).

## M1 — Event collector and memory

- [ ] M1-01: Monorepo scaffold, contract schemas and versioned local API (AT-003/004/025).
- [ ] M1-02: Daemon lifecycle, user-only token file, discovery, loopback binding and OS ACL tests (AT-020/025).
- [ ] M1-03: Canonical event validation/sanitization, source registration, deduplication and 64-KiB limit (AT-003/004/026).
- [ ] M1-04: SQLite migrations, transactional event+job enqueue, lease/recovery idempotency (AT-009/027).
- [ ] M1-05: Connector spool, retry, privacy controls and uninstall (AT-001/008/022).
- [ ] M1-06: Typed memory extraction and evidence linking, project registration/worktree identity (AT-010/012).
- [ ] M1-07: FTS5 retrieval and context injection with bounded response/timeout (AT-011/012).
- [ ] M1-08: CLI status/doctor plus observability counters, no extra raw transcript log (AT-019).

## M2 — Automated self-learning

- [ ] M2-01: Pluggable inference interface with disabled default and per-project caps (AT-016).
- [ ] M2-02: Deterministic signal detection, candidate dedupe and scope evaluation (AT-010/013).
- [ ] M2-03: Immutable candidate registry, evidence provenance and state machines (AT-013/014).
- [ ] M2-04: Evaluation fixtures, baseline/candidate replay and negative/regression suite (AT-014).
- [ ] M2-05: Atomic publication of declarative resources into native managed provider paths (AT-015/024).
- [ ] M2-06: Rollback and drift reconciliation, including crash during publication (AT-015/023).
- [ ] M2-07: Multi-project privacy and prompt-injection red-team suite (AT-012/022/026).

## M3 — Guard and visibility (optional)

- [ ] M3-01: Deterministic loop signatures with false-positive benchmark (AT-017).
- [ ] M3-02: Enable native provider blocking only for proven capability and policy (AT-018).
- [ ] M3-03: CLI reports for correction recurrence, cost estimates and release outcomes (AT-019/028).
- [ ] M3-04: Optional read-only T3 panel consuming the public API without package imports (AT-021).
- [ ] M3-05: Packaging and install/uninstall on Windows and Linux with restore validation (AT-020).

## Project constraints for every PR

- No new T3 core dependency or additional agent orchestration engine.
- No unverified claims that Codex/OpenCode hooks fire in T3-launched sessions.
- No auto-generated executable or credential-modifying publication.
- No uncontrolled external inference or raw transcript collection.
- Evidence and tests included with each behavior change; keep releases reversible.
- Use automated tests for migrations and normalizers and replay tests for provider adapters.

