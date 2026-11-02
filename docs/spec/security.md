# Security and trust boundaries

## Threat model

The Harness sees lower-trust tool output, repository files and possibly user corrections. Attackers may embed instructions in README/tool output, forge a successful result, force repeated model calls, poison global knowledge, supply secrets in output or manipulate file paths. A local process might attempt unauthorized HTTP access.

## Trust levels

1. **Provider callback metadata**: authenticated by local connector token, but tool outputs remain untrusted.
2. **Evidence**: factual events after normalization and sanitization; not executable policy.
3. **Learning proposal**: untrusted model output until validation.
4. **Evaluated artifact**: immutable content with documented tests and allowed scope.
5. **Published artifact**: activated under a defined policy, never granted extra permissions by default.

Text from repository/tool output must never be treated as instructions for the Harness daemon or reviewer.

## Data minimization

- Default: event type, tool name, status, hashed normalized input/output signatures, model usage where observable, project/agent correlation, timing.
- Exclude by default: prompt body, shell output, raw code, home paths, tokens, email, URLs with credentials, environment variables and entire transcripts.
- Optional opt-in snippets must pass redaction/classification and explicit per-project retention settings. Reject uncertain high-sensitivity content rather than promoting it.
- Project data is never sent to inference without per-project policy permitting the selected backend and data class.
- Never log bearer tokens, provider account secrets, transport authorization or sensitive snippets.

## Local server security

- Listen only on 127.0.0.1 with a random ephemeral port.
- Token has at least 256 bits of entropy; store in a separate user-private credential file, not in stdout or process args.
- POSIX permissions 0600 for credentials, user-only directory; on Windows use current-user ACLs and fail closed when ACLs cannot be established.
- Validate Origin/Host where relevant, avoid implicit browser CORS access, and require bearer token for all data-bearing operations. /health returns only status/protocol.
- Request limits: 64 KiB per event, 1 MiB per batch when enabled, bounded concurrent connections, fixed timeouts.
- No arbitrary file path requests in the HTTP API. Validate project ownership server-side, never trust path or scope from a connector payload alone.
- No cleartext service binding to LAN interfaces; no remote admin in V1.

## Filesystem and execution safety

- Use canonical path checks against registered roots; prevent symlink traversal outside managed install directories.
- Create immutable version files then atomic rename; never overwrite non-managed user config without a preview and explicit install action.
- Evaluation commands are allowlisted per project, run in disposable workspaces with minimal credentials and network policy.
- Auto-generated **executable** hooks, MCP binary commands, agent launch args, environment and authentication config are prohibited.
- Git is only a revision store owned by the Harness. Never force push, rewrite a user's worktree or reset source repositories.
- Sensitive evidence stored on disk is encrypted only if explicitly implemented/tested; V1 should instead avoid collection and protect local files.

## Cross-scope poisoning

Global promotion forbids unreviewed client data, raw snippets, identifiers, absolute paths, credentials and conclusions drawn from a single project. The global catalog is opt-out by policy and can be restricted to independently validated general knowledge. Treat every retrieved memory as scoped and provenance-bearing.

## Failure behavior

Daemon offline: no agent execution error. Injection unavailable: no memory injected. Guard capability unknown: observe only. Evaluation cannot verify a result: do not publish. Connector configuration error: do not mutate native permissions. If user revokes collection, uninstall connector and prevent further ingestion.

