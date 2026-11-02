# ADR-0005 — Evidence-gated automatic promotion

**Status:** Accepted · 2026-11-02

## Decision

A learned candidate is not a published artifact. Promotion requires provenance, structural validation, scope/security checks, successful replay of the triggering case, and regression comparison against the active version. Publisher is single-writer and atomic, with a versioned rollback path.

## Alternatives

- Automatically append each correction to AGENTS.md: low effort, contradictory instructions, high prompt cost.
- Human approve every change: slows the desired autonomous learning loop.
- Unrestricted self-modification: permits malicious or untested executable changes.

## Consequences

V1 may autonomously publish supported memory types and declarative skill/rule content. Executable hooks, provider authentication files, MCP executable command definitions and arbitrary source patches are prohibited as automatically generated outputs. Missing evaluation evidence means no promotion, not optimistic approval.

