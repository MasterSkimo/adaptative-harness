# Adaptive Harness

Provider-independent, local-first **learning and governance companion** for coding agents. The repository intentionally retains its published name `adaptative-harness`.

> **Status: initial OpenCode 2 implementation in progress.** Local collection, evidence-linked project memory, CLI, and guarded declarative registry are implemented; live OpenCode 2/T3 integration and release acceptance remain unverified. Auto-promotion is disabled unless an independent, isolated replay evaluator is supplied.

## Objective

Learn from Codex and OpenCode executions, retain evidence-backed memories, evaluate proposed skills/rules, and publish versioned improvements **without owning the agents' orchestration loops**. T3 Code remains an optional launcher/viewer, never a runtime dependency.

## Non-negotiable principles

1. No changes to the T3 Code core for V1. Native agent extensions are the primary attachment points.
2. No second orchestration engine or interception of subscription/OAuth model traffic.
3. Agent execution continues when the learning service is unavailable (fail-open observation/retrieval).
4. Secrets, private client code, and raw transcripts are not collected by default.
5. An automated promotion requires reproducible evidence and a passing regression gate.
6. Independent project scopes; global promotion is restricted by policy.
7. One local daemon, SQLite, versioned files, no cloud or Docker requirement.
8. Codex App Server / OpenCode 2 integration through T3 is a **hypothesis to validate in Spike 0**, not a claimed capability.

## Read in order

- [Architecture and component boundaries](docs/architecture/overview.md)
- [V1 functional specification](docs/spec/v1-functional.md) and [non-functional requirements](docs/spec/v1-non-functional.md)
- [Provider adapter contract](docs/contracts/adapter.md) and [event envelope](docs/contracts/events.md)
- [OpenAPI contract](docs/api/openapi.yaml)
- [SQLite schema](migrations/0001_init.sql) and [storage rules](docs/spec/storage.md)
- [Memory, learning and promotion](docs/spec/learning-lifecycle.md)
- [Security and trust boundaries](docs/spec/security.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Acceptance criteria](docs/testing/acceptance.md)
- [Spike 0 runbook](docs/plan/spike-0-runbook.md) and [implementation backlog](docs/plan/backlog.md)

## Repository shape

```text
apps/{daemon,cli}/                 # Node.js 24 local runtime and commands
packages/{contracts,connectors,core,storage}/  # Contracts, native OpenCode 2 plugin, memory and registry
docs/architecture/                # Component and sequence boundaries
docs/api/                         # Local API contract
docs/contracts/                   # Event/adapter contracts and fixtures
docs/adr/                         # ADRs, decisions and tradeoffs
docs/spec/                        # Invariants, privacy, storage, lifecycle
docs/testing/                     # Executable acceptance plan
docs/plan/                        # Ordered milestones, spike and backlog
migrations/                       # Versioned SQLite schema (0001–0003)
```

## V1 delivery sequence

**Spike 0: OpenCode 2 attachment verified on Windows; remaining reliability/Linux checks open** → **M1: OpenCode event ingestion + memory** → **M2: learning + evaluation + publication** → **M3: guardrails and optional T3 UI**. **Codex support is deferred**, not removed from the provider-neutral design.

Proceed with OpenCode-only implementation after the observed Windows CLI/T3 attachment. Before claiming an OpenCode release, validate fail-open operation, durability, child-agent coverage where supported, and Linux. Codex CLI/T3 attachment does not gate the first release. See [ADR-0009](docs/adr/0009-opencode-first-release.md).

## Current delivery priority

**OpenCode 2.x is the sole V1 runtime target.** Spike 0 observed plugin callbacks and context injection in both direct CLI and T3-launched sessions on Windows. Codex App Server hook delivery under T3 remains unverified; defer its adapter and acceptance gate rather than patching T3 or bypassing hook trust. See [Windows evidence](docs/plan/spike-0-windows-evidence.md) and [ADR-0009](docs/adr/0009-opencode-first-release.md).

## Running the implementation

See [the runtime runbook](docs/operations/runtime.md) for commands, scope handling, testing, and release limitations.

## Initial technical decisions

TypeScript/Node.js LTS, SQLite WAL + FTS5, versioned text artifacts and local Git revisions. An on-demand loopback daemon exposes a small HTTP API. Provider-native plugins/hooks are separate adapters. LLM inference and semantic search are replaceable ports. No external services required in V1.

See [ADR index](docs/adr/README.md) for alternatives and consequences.

## License

No license has been selected. The repository is public, but publication does not by itself grant reuse or redistribution rights. Choose a license before inviting external contributions.
