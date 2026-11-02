# ADR-0001 — Independent learning companion

**Status:** Accepted · 2026-11-02

## Context

T3 Code already manages sessions, provider adapters, tool presentation, subagents, recovery and orchestration. Embedding learning logic in that core creates large upstream merge conflicts and conflates presentation with policy.

## Decision

Run learning, memory, evaluation and publication in an independently versioned repository and process. T3 is neither a compile-time nor runtime dependency. Agents remain owned by their native providers. A future T3 side panel may consume the public local API without mutating the agent loop.

## Options

- **Embed directly into T3:** integrated UX and event access; high maintenance, fragile upstream upgrades, loss of direct CLI learning.
- **Separate companion (chosen):** works with multiple launchers and upgrades independently; requires connector contracts and a daemon lifecycle.
- **Proxy all models:** comprehensive request interception; breaks the desired OAuth/subscription transparency and increases risk.

## Consequences

The hardest unknown becomes connector attachability in T3-controlled native sessions. Spike 0 must establish this before feature work. An optional, read-only T3 event exporter requires a separate ADR if native points prove insufficient.

