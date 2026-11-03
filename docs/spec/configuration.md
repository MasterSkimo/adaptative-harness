# Configuration and local runtime contract

## Configuration hierarchy

1. Baked safe defaults.
2. User settings `config.json` under private Harness user data.
3. Project policy registered by opaque `projectId` and verified workspace roots.
4. Session overrides limited to retrieval budget; they cannot weaken privacy or scope.

A project policy cannot silently allow external inference when user-level privacy policy denies it. Runtime connector config remains owned by providers.

## Configuration file

`config.json` is optional; absent keys use these defaults:

```json
{
  "schemaVersion": 1,
  "transport": { "host": "127.0.0.1", "port": 0, "contextTimeoutMs": 100 },
  "privacy": { "rawTranscripts": false, "sensitiveExcerpts": false, "externalInference": false },
  "collection": { "enabled": true, "maxEventBytes": 65536, "spoolBytes": 10485760 },
  "memory": { "maxItems": 5, "maxTokens": 600, "retentionDays": 30 },
  "learning": { "enabled": true, "maxDailyEstimatedUsd": 0, "inferenceBackend": "disabled" },
  "evaluation": { "isolatedExecutionRequired": true },
  "loopGuard": { "mode": "observe", "preToolTimeoutMs": 30 }
}
```

`memory.retentionDays` is an integer from 1 to 3650. It sets `valid_until` on
heuristically derived lessons; expired lessons are never retrieved. Unsafe
combinations (non-loopback host, raw transcripts, excerpts, oversized payloads,
invalid retention) are rejected at load time.

There is no auto-promotion switch: publication always requires an external
replay evaluation, and heuristic lessons always start as candidates.

No API keys, tokens or passwords belong in this file. Credential file is separate and permission-restricted.

## CLI surface

- `adaptive-harness install --provider opencode --scope user|project [--root PATH] [--apply]`
- `adaptive-harness doctor --provider opencode --launcher cli|t3 --json`
- `adaptive-harness status [--json]`
- `adaptive-harness project register --root PATH`
- `adaptive-harness daemon start|stop`
- `adaptive-harness memory search --project ID QUERY`
- `adaptive-harness memory list --project ID [--status candidate|published|archived]`
- `adaptive-harness memory publish MEMORY_ID`
- `adaptive-harness memory archive MEMORY_ID`
- `adaptive-harness candidates list|propose|evaluate`
- `adaptive-harness evaluations show ID`
- `adaptive-harness releases list|publish|rollback`
- `adaptive-harness uninstall --provider opencode --scope user|project [--apply]`

Install and uninstall are preview-first: they never write without `--apply`, and
they refuse to replace a file whose content is not the reviewed connector.

## Runtime handshake

The daemon acquires `runtime/daemon.lock` before listening. A lock owned by a
live process fails closed; a lock left by a dead process is replaced. The
discovery file contains protocol version, bound port, PID, an instance ID and the
state-root fingerprint, written atomically. A discovery record with a foreign
fingerprint is ignored. The bearer token lives in a separate private file, never
in discovery or process arguments.

`daemon stop` calls the authenticated `POST /v1/daemon/stop` endpoint. It never
signals a PID read from disk. If the recorded owner is already dead, the CLI
removes the stale discovery and lock files instead.

## External inference

Possible backends: disabled (default), provider CLI, OpenAI-compatible endpoint and local Ollama. Backend must be explicitly enabled with data handling policy, rate/token budget and model name. Subscription CLI reuse is a hypothesis pending compatibility testing; never ask T3 to export OAuth tokens.
