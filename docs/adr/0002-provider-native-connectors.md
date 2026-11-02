# ADR-0002 — Provider-native connectors

**Status:** Accepted · 2026-11-02

## Decision

Implement independent Codex and OpenCode 2 adapters using officially supported provider extension points. Each adapter declares observed capabilities (not assumed capabilities) and translates native data into a versioned canonical event envelope. Keep implementation outside T3 and outside the learning core.

## Alternatives

- Directly read provider persistence: useful as read-only fallback, but internal formats change and may omit live events.
- Wrap provider process/HTTP server: invasive lifecycle and authentication changes.
- Patch T3 adapters: reliable data access but causes upstream coupling.
- MCP-only sidecar: useful for explicit lookups, insufficient for complete lifecycle observation without native hooks.

## Consequences

Maintain a compatibility matrix per exact runtime version; test CLI and T3-launched sessions separately. Permit partial coverage and honest capability reports. Install/uninstall must not destroy user configuration or comments.

