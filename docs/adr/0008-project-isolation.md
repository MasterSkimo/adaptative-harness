# ADR-0008 — Isolated project scopes and guarded global promotion

**Status:** Accepted · 2026-11-02

## Decision

Learned content is owned by a stable project identity and remains private to that project by default. Projects inherit explicitly approved global knowledge. A session reads project first, then eligible global results; no search across other projects. Global promotion requires generalized, non-sensitive content supported by independent evidence and policy checks.

## Alternatives

- Single shared memory: cross-client contamination and prompt pollution.
- Completely isolated memory: no reuse of general lessons across projects.
- Infer scope solely from path: unstable after moves and worktrees.

## Consequences

Project registration uses an opaque stable project ID with bound roots, not an untrusted path string. Worktrees inherit the same project only after identity verification. Scope changes create new immutable versions and audit records. Global promotion of client examples, raw source, credential material or absolute paths is forbidden.

