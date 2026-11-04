# ADR-0010 — Local read-only GUI for Harness observability

**Status:** Accepted · 2026-11-03

## Context

Harness has independent SQLite-backed observation, learning and publication. The user needs a way to see what Harness records, including when T3 is not running, while preserving the no-T3-core-patch constraint.

## Decision

1. Serve a **read-only GUI** from the existing daemon on its ephemeral `127.0.0.1` port. No cloud, no additional process, no mandatory UI framework.
2. Isolate browser access under `/ui` and `/ui/api/*`. Existing `/v1/*` continues to require the private CLI/connector bearer.
3. `adaptive-harness ui` requests a **one-time 256-bit pairing code** using the private CLI bearer. Code TTL: 60 seconds. On redemption, the daemon issues an in-memory, 2-hour session cookie with `HttpOnly; SameSite=Strict; Path=/ui`.
4. Expose fixed SQLite read projections, paginated to 100 records per request, filtered by registered project. Never expose credentials, raw model content, arbitrary SQL or local root paths.
5. Refresh every four seconds while visible; support pause/restart, project selection, drill-down, history pagination and status.
6. Serve assets locally under a restrictive CSP, no-referrer, no-cache and frame denial. Browser sessions cannot mutate events, memory, releases, or agent permissions.
7. Display only **recorded evidence**. No claims of observing private reasoning, uncollected calls or provider billing.

## Rejected alternatives

- Embedding the panel in the T3 core: upstream merge burden and coupling.
- Anonymous loopback endpoints: local cross-site data exfiltration risk.
- Sending the persistent daemon bearer to the browser or localStorage: credential persistence and privilege escalation.
- Remote dashboard or new WebSocket service: extra lifecycle and deployment surface.

## Consequences

The browser sees scoped metadata and state transitions, not every agent action. The short-lived pairing link may appear in a browser process argument briefly; it **is not** the persistent bearer and is single use. Do not store it in diagnostics. All browser state is cleared when the daemon restarts.

Verification: [UI-001–012](../testing/v1-test-plan.md) plus [AT-019/021/025/026](../testing/acceptance.md). Synthetic tests do not establish OpenCode/T3 integration correctness or release readiness.
