# ADR-0009 — OpenCode 2 first release; Codex deferred

**Status:** Accepted · 2026-11-02

## Context

Spike 0 on Windows 11 observed OpenCode 2.2.5 plugin startup, pre/post-tool hooks, context injection and skill discovery in direct CLI (**108 sanitized rows**) and T3-launched sessions (**193 rows**). It did **not** validate daemon-outage recovery, durable spool, Linux behavior, native parent-child lineage or skill reload.

Codex 0.166.0 direct CLI hooks were observed (**37 rows**), but the T3-launched Codex App Server session did not invoke the test collector. OpenAI Codex issue [#45856](https://github.com/openai/codex/issues/45856) documents a related App Server project-hook trust/discovery problem. This is a **hypothesis**, not proof that the observed failure originates in T3 or a particular Codex bug.

See [Windows evidence](../plan/spike-0-windows-evidence.md).

## Decision

1. The **first delivery targets OpenCode 2.x exclusively**. Proceed with an OpenCode-specific vertical slice of M1, without blocking on Codex integration.
2. Keep event envelopes, data models, inference, memory, evaluation and publication **provider-independent**. Do not embed OpenCode SDK types in the core.
3. Defer Codex connector implementation and its acceptance test **AT-006**, and defer cross-provider concurrency to a later release. Do not claim those tests passed.
4. Keep T3 Code unmodified. Use the native OpenCode plugin, including when sessions are launched by T3.
5. Treat Windows attachment as a feasibility **GO for implementation**, not a production readiness GO. Fail-open, spool/recovery, Linux, child lineage and skill reload remain exit criteria.
6. No unsupported workaround to disable Codex hook trust globally and no Codex OAuth interception.

## Options considered

- **Wait for Codex and OpenCode before starting M1**: maximizes symmetry but leaves a working OpenCode integration idle and couples delivery to upstream changes.
- **OpenCode-first (chosen)**: validates the full learning pipeline sooner with native callbacks already observed under T3; introduces temporary unequal provider support.
- **Patch T3 Codex integration immediately**: creates core-maintenance risk and weakens independence before the actual Codex root cause is proven.

## Consequences

- README, backlog, release gates and acceptance criteria identify OpenCode as the first supported runtime.
- Minimal M1 vertical slice: OpenCode native event → sanitized ingestion → SQLite durable state → verified correction evidence → project memory → bounded context retrieval into a new OpenCode session.
- Next M1 work adds spool/replay, crash recovery, project isolation and security gates. Self-learning skill publication remains M2, not bundled with the first collector milestone.
- Codex can be added as a connector after hook trust/launch compatibility is demonstrated; core design must not require schema redesign.
- No reclassification of the full **multi-provider** Spike 0 as complete: it is explicitly postponed in scope.

## Verification

Acceptance: AT-002, AT-003, AT-004, AT-005 (where native evidence exists), AT-007–012, AT-016, AT-020–022, AT-025–027 relevant to M1 OpenCode. Treat unobserved child lineage as nullable. Verify fail-open and Linux before calling the OpenCode release production-ready.
