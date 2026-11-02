# Canonical event envelope V1

This contract is intentionally **provider-agnostic**. An adapter maps native hooks/events into these fields; its output cannot claim more telemetry than the provider supplies.

## Wire contract

- HTTP: `POST /v1/events` with `application/json`; individual event maximum 64 KiB. First accepted event: `202`; exact duplicate: `200`; same producer/event ID with differing payload hash: `409`.
- Required fields: `schemaVersion` (=1), `eventId` (producer-stable UUID), `sourceInstanceId` (stable opaque installation ID), `provider`, `providerVersion` when observable, `nativeSessionId`, `projectId` (registered), `eventType`, `occurredAt`, `observedAt`, `privacyClass`.
- Optional correlation: `turnId`, `nativeAgentId`, `parentNativeAgentId`, `parentNativeSessionId`, `spanId`, `parentSpanId`, `launcher`, `runtimeMode`.
- `metadata` includes allowlisted status/timing/token counts, opaque signature digests and sanitized context signals. No arbitrary nested transcript payload.
- `outcome` is `succeeded | failed | cancelled | blocked | unknown`; unknown cannot be treated as success.
- `privacyClass` is `metadata | redacted_excerpt` and cannot be overridden by HTTP caller to evade project policy.

See machine-readable [JSON Schema](event-v1.schema.json) and [example](examples/event.json).

## Event type taxonomy

| Type | Semantics | Typical evidence |
|---|---|---|
| `session.started`, `session.ended` | Native session lifecycle | provider session ID and time |
| `turn.started`, `turn.ended` | Provider-model turn lifecycle if observable | turn or message ref |
| `tool.started`, `tool.completed` | Tool invocation and terminal result | normalized tool name, input digest, status, duration |
| `subagent.started`, `subagent.ended` | Native child agent lifecycle | child ID and optional parent ID |
| `message.corrected` | Correction detected by eligible source | reference to prior response and user confirmation |
| `provider.diagnostic` | Integration version/health/capability change | doctor result and diagnostic code |

A connector must not fabricate child IDs or attach a result to a parent based only on temporal proximity.

## Ingestion guarantees

1. Deduplication key is **(sourceInstanceId, eventId)**. Retransmission reuses the exact same ID and payload. Hash conflict is an error.
2. Provider timestamps can arrive out of order; `observedAt` and daemon `receivedAt` support diagnosis. Wall clocks are not assumed synchronized.
3. Unknown schema version is rejected with non-retryable error. The connector reports server protocol compatibility.
4. `projectId` is resolved/authorized using registered workspace roots and connector identity, not trusted blindly.
5. Persist sanitized content and schedule classification within one transaction. Accepted events survive daemon restart.
6. Canonical envelope IDs must not embed personal access tokens, absolute paths or secret values.
7. Schema privacy cannot ensure redaction alone: adapter sanitizes before sending; daemon revalidates allowlists.
8. Storage may keep event-specific `metadata` only; raw tool/LLM messages are excluded in V1 default.
9. Multiple connectors for one native session may produce events; dedupe is per-source and semantic aggregation separately detects overlap.

## Example: failure → correction → replay

Tool failure and later success share `nativeSessionId`, optional `turnId` and signature digests. Their event IDs remain distinct. Learner emits a proposed lesson that references both stored evidence records. A proposal without an observed success is only a hypothesis and cannot claim a verified repair.

