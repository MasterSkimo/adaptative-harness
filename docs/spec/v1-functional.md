# V1 functional specification

**Status:** Implementation-ready specification, not implementation · 2026-11-02

## Goal

An autonomous, provider-independent local learning companion for coding agents. First targets: Codex and OpenCode 2.x, launched either directly or by T3 Code. No source-level dependency on T3.

## V1 capabilities and requirement IDs

| ID | Requirement | Priority | Verification |
|---|---|---|---|
| FR-001 | CLI installs/removes each provider connector idempotently without overwriting unrelated user configuration | Must | AT-001 |
| FR-002 | CLI diagnoses provider version, hook/plugin loading, scopes and effective profile | Must | AT-002 |
| FR-003 | Provider events normalized, validated, sanitized, persisted and deduplicated | Must | AT-003/004 |
| FR-004 | Child agents correlated with parent sessions when native evidence permits; unknown relationships explicitly nullable | Must | AT-005 |
| FR-005 | CLI and T3-started agent runs use the same local Harness and storage | Must | AT-006/007 |
| FR-006 | Observing events does not delay or block provider execution when daemon unavailable | Must | AT-008 |
| FR-007 | Persistent event-to-job delivery and crash-safe retry; no double-learning from duplicate delivery | Must | AT-009 |
| FR-008 | Extract fact, decision, lesson and procedure candidates from verified events | Must | AT-010 |
| FR-009 | Scoped keyword search and bounded memory retrieval; project first, then permitted global | Must | AT-011 |
| FR-010 | Per-scope policies prevent cross-project retrieval or accidental globalization | Must | AT-012 |
| FR-011 | Produce declarative skill and rule proposals with evidence, logical identity, version and provenance | Must | AT-013 |
| FR-012 | Promotion requires static, triggering-replay and regression evidence | Must | AT-014 |
| FR-013 | Publish atomic native artifacts and support audit+rollback | Must | AT-015 |
| FR-014 | Inference backend interchangeable, opt-in, bounded by configured budgets | Must | AT-016 |
| FR-015 | Support deterministic signature-based loop detection without becoming orchestrator | Should | AT-017 |
| FR-016 | Runtime guard blocks only when adapter has verified native enforcement capability | Should | AT-018 |
| FR-017 | Expose events, release history, metrics and diagnoses through CLI/local read APIs | Should | AT-019 |
| FR-018 | Separate Windows and Linux user scopes; no Docker/remote dependency | Must | AT-020 |
| FR-019 | Independent restart and lifecycle from T3 without changing its core | Must | AT-021 |

## Scope

- **User installation**: one daemon per OS user identity.
- **Project**: opaque project ID registered against one or more verified workspace roots. Worktrees require explicit association.
- **Session**: one provider-native session under a provider instance, optionally with a parent.
- **Global**: only artifacts/memories passing de-identification and promotion checks.
- **No automatic import of other provider settings** until a compatibility-tested migration/export route exists.

## Primary flows

1. Adapter installation detects the native provider, previews configuration changes, installs an event source, and verifies activation.
2. Provider emits a lifecycle/tool/subagent signal; connector maps it to the canonical envelope, redacts and sends it with a stable event identifier.
3. Daemon validates and persists event, returns acceptance receipt, then enqueues classification; learning happens after the agent call.
4. Learning extracts a candidate and evidence set; deterministic checks deduplicate and classify scope; optional LLM reflection enriches without claiming unobserved success.
5. Evaluator compares proposed content with the current active content using isolated replay tasks and regression cases. A missing scoring signal does not count as a pass.
6. Publisher stages a new immutable version and atomically exposes native artifacts. Existing active sessions may keep prior versions until next supported reload.
7. Context hook asks for bounded, scoped material. On timeout, provider receives no additional context; no exception propagates to agent runtime.
8. Session continues even if daemon is down. Connector replay occurs from a bounded local spool if permitted.

## Publication policy

Memory records are not necessarily skills. A single correction creates a project-scoped lesson **candidate**, not an immediate global rule. Promoting an instruction requires a reproducible failing trigger and regression evidence. Promoting an executable hook/MCP command or modifying agent runtime config as learned code is prohibited in V1. Provider connector installers may write **predefined, reviewed** hook/plugin code.

## Out of scope

A new agent loop, DAG scheduling, cancellation and retry of agent tasks, UI-driven manual task control, model traffic proxy, OAuth credential custody, arbitrary code mutation, distributed learning and synchronization, automatic external telemetry, model weight training.

## Dependencies and assumptions

Spike 0 must prove native callbacks or independently retrievable traces for the *actual* T3 provider launching modes, not only direct CLI. The runtime APIs and feature flags are versioned and may differ across provider releases; unknown provider capabilities are reported as unsupported/unknown, never silently assumed.

