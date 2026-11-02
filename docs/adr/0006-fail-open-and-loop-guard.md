# ADR-0006 — Fail-open learning and bounded Loop Guard

**Status:** Accepted · 2026-11-02

## Decision

All observation, memory lookup, inference, and learning operations are fail-open with tight deadlines. Provider-native permission controls remain authoritative. A separately enabled Loop Guard may block only through a verified synchronous pre-tool capability, using deterministic repeated-failure signatures and a bounded local cache.

## Alternatives

- Block the agent when daemon is unreachable: undermines T3/CLI reliability.
- Semantic LLM decisions on every tool call: high latency, unpredictable behavior.
- Disable all protection: loses useful loop signaling.

## Consequences

Never claim block coverage for adapters that lack pre-tool enforcement. Fail-open is **not** a bypass of native provider safety and permissions. Disable guarding by default until false-positive tests pass. Learn from guard events asynchronously.

