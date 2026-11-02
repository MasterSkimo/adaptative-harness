# ADR-0003 — Local daemon with loopback HTTP

**Status:** Accepted · 2026-11-02

## Decision

One user-scoped daemon exposes a versioned HTTP API bound only to 127.0.0.1; clients use a user-private port-discovery file and a separately stored random bearer token. Never bind 0.0.0.0. Never expose token, prompts or workspace paths in logs. Use strict request/response size and timeouts.

## Alternatives

- Per-adapter embedded engine: zero daemon lifecycle, but concurrent writers and duplicate learning.
- Named pipes/Unix domain socket: better local ACL fit, cross-platform and JS SDK complexity.
- Cloud service: multi-device, but adds cost, privacy obligations and network dependency.

## Consequences

CLI needs start/stop/doctor; stale process PID handling; atomic discovery-file updates; permission enforcement for POSIX and Windows ACLs. The daemon returns before learning starts; connectors spool or drop observational events when unavailable. Retrieval is bounded and fail-open.

