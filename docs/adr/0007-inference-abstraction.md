# ADR-0007 — Replaceable inference backend

**Status:** Accepted · 2026-11-02

## Decision

Learning uses an InferencePort with limits on budget, tokens, privacy scope, concurrent calls and model identity. Candidate backends: user-installed Codex/OpenCode CLI (subject to headless auth verification), OpenAI-compatible endpoint, and local Ollama. Never route native coding-agent model traffic through the Harness.

## Alternatives

- Hardwire one provider: simpler implementation, provider lock-in.
- Proxy all Codex/OpenCode requests: more uniform observation, but OAuth/subscription and streaming incompatibilities.
- No inference: sufficient for deterministic diagnostics, not for extracting generalized lessons.

## Consequences

Inference is disabled until configured. Record backend/model/version and consumed budget with evidence. A task failing due to inference availability remains queued; no provider turn is affected.

