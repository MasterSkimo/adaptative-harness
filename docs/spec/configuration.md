# Configuration and local runtime contract

## Configuration hierarchy

1. Baked safe defaults.
2. User settings `config.json` under private Harness user data.
3. Project policy registered by opaque `projectId` and verified workspace roots.
4. Session overrides limited to retrieval budget; they cannot weaken privacy or scope.

A project policy cannot silently allow external inference when user-level privacy policy denies it. Runtime connector config remains owned by providers.

## Illustrative configuration (proposal, not implemented)

```json
{
  "schemaVersion": 1,
  "transport": { "host": "127.0.0.1", "port": 0, "contextTimeoutMs": 100 },
  "privacy": { "rawTranscripts": false, "sensitiveExcerpts": false, "externalInference": false },
  "collection": { "enabled": true, "maxEventBytes": 65536, "spoolBytes": 10485760 },
  "memory": { "maxItems": 5, "maxTokens": 600, "retentionDays": 30 },
  "learning": { "enabled": true, "maxDailyEstimatedUsd": 0, "inferenceBackend": "disabled" },
  "evaluation": { "isolatedExecutionRequired": true, "autoPromoteDeclarative": true },
  "loopGuard": { "mode": "observe", "preToolTimeoutMs": 30 }
}
```

No API keys, tokens or passwords belong in this file. Credential file is separate and permission-restricted.

## CLI surface (planned)

- `adaptive-harness install --provider codex|opencode --scope user|project --dry-run`
- `adaptive-harness install --provider ... --apply` (predefined connector only)
- `adaptive-harness doctor --provider codex|opencode --launcher cli|t3 --json`
- `adaptive-harness status [--json]`
- `adaptive-harness project register --root PATH`
- `adaptive-harness memory search --project ID QUERY`
- `adaptive-harness candidates list`, `evaluations show ID`, `releases rollback ID`
- `adaptive-harness uninstall --provider ... --dry-run|--apply`
- `adaptive-harness daemon start|stop`

These commands are **proposed CLI contracts**; they do not exist yet.

## Runtime handshake

Discovery file contains protocol version, bound port and PID, written atomically. Credential file stores bearer token, not embedded in discovery. Client verifies server protocol range and health before authenticated operations. When discovery is stale, clients may re-check once; no busy-wait restart loops inside provider hooks.

## External inference

Possible backends: disabled (default), provider CLI, OpenAI-compatible endpoint and local Ollama. Backend must be explicitly enabled with data handling policy, rate/token budget and model name. Subscription CLI reuse is a hypothesis pending compatibility testing; never ask T3 to export OAuth tokens.

