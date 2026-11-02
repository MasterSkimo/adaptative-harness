# Ordered implementation backlog

**Delivery focus (ADR-0009): OpenCode 2.x only for the first release.** Preserve provider-neutral contracts but do not implement the Codex adapter or block M1 on Codex App Server hook trust. Every item links to test IDs, accepted ADRs and measured results. Windows OpenCode CLI/T3 attachment has been observed; degradation, Linux and skill reload remain open.

## S0 — OpenCode 2 connectivity and reliability

- [x] S0-01: Capture Windows OpenCode runtime, T3 version and project-local effective plugin loading (AT-002; global inheritance still unknown).
- [x] S0-02: Observe OpenCode 2.x plugin startup, tool pre/post, context injection and skill discovery under direct CLI AND T3 on Windows (AT-007; [evidence](spike-0-windows-evidence.md)).
- [ ] S0-03: Verify sanitized native child-agent lifecycle/correlation, explicitly marking unavailable IDs unknown (AT-005).
- [ ] S0-04: Kill collector during an OpenCode call, verify bounded fail-open timeout, spool/replay, no agent failure (AT-008/009/021).
- [ ] S0-05: Verify skill publication/reload semantics and T3 OpenCode effective config inheritance (AT-002/015/024).
- [ ] S0-06: Repeat OpenCode CLI and T3 integration on Linux; treat WSL as separate (AT-020).

### Deferred (does not gate OpenCode M1)

- [ ] D-CODEX-01: Diagnose Codex App Server hooks/list, project trust and effective shadow CODEX_HOME in T3 (AT-006).
- [ ] D-CODEX-02: Add Codex connector and cross-provider tests when native hook activation is demonstrable (AT-006/028).

## M1 — OpenCode event collector and memory

**First implementation increment:** scaffold Node/pnpm workspace and OpenCode 2 plugin; implement sanitized event POST with SQLite dedupe and local bearer auth. Next increment: durable queue/spool and a bounded context resolver. Build daemon/provider connector independently of T3. Limit the first vertical slice to one observed tool failure → one verified repair → evidence-linked project memory → retrieval in a new OpenCode session; do not generate skills yet.


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


## M1 ingestion implementation status (2026-11-02)

Prototype implementation in progress: canonical validation, local HTTP ingestion, SQLite transaction/idempotency and an OpenCode 2 native plugin are present. Windows direct CLI produced two tool starts and two completions after a failed then successful command; outcome was not exposed in persisted events. An offline CLI task completed. Node 24 Windows: typecheck and 15 Vitest cases passed; Python specification tests: 6 passed. These are not the full M1 acceptance gate. Open: T3 verification for this implementation, Linux, reliable outcome and lifecycle coverage, installer/ACL hardening, automated native integration, concurrency and transaction-failure tests, robust lifecycle, durable bounded spool and explicit loss reporting.
