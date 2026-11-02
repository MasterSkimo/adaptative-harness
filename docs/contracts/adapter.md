# Provider connector contract and capability negotiation

## Role

Connector translates native provider lifecycle and tool events to a canonical envelope; it does not own model execution, provider authentication, evaluation or learning. Native extensions are preferred over shell wrappers. A connector must support CLI-started and T3-started sessions when the runtime allows it, and report exactly which combination was actually tested.

## Capability negotiation

Each capability value is `supported | unsupported | unknown`, accompanied by `observedAt`, provider version, launcher, OS and optional evidence reference:

- `session_events`: session boundaries.
- `tool_before` / `tool_after`: tool metadata and result.
- `subagent_lifecycle`: reliable child IDs and parent relationship where exposed.
- `transcript_reference`: opaque provider transcript reference without raw body.
- `context_injection`: bounded per-turn context.
- `compaction`: hook for summary or retained memory context.
- `synchronous_block`: deterministic pre-tool decision enforced by native runtime.
- `skills_read` / `skills_write`: discover and publish managed skills.
- `config_reload`: exact semantics for native plugin/skill update.

Do not route a blocking decision unless `synchronous_block` is both supported and explicitly enabled.

## TypeScript port proposal

```typescript
// Package: @adaptive-harness/connectors (proposed)
// Imports come from provider-independent contracts; no T3 imports.
import type { CanonicalEventV1, CapabilityReportV1, ContextResponseV1 } from "@adaptive-harness/contracts";

export interface ProviderConnector {
  readonly provider: "codex" | "opencode";

  // Inspect effective runtime; must not mutate user configuration.
  doctor(): Promise<CapabilityReportV1>;

  // Preview a scoped, reversible installation.
  planInstall(input: { scope: "user" | "project"; root?: string }): Promise<{
    changes: readonly { path: string; operation: "create" | "merge" | "remove" }[];
    warnings: readonly string[];
  }>;

  // Explicit installation of reviewed connector code only.
  applyInstall(): Promise<void>;

  // Called from native hooks; resolve or drop fast on daemon failure.
  mapNativeEvent(native: unknown): CanonicalEventV1 | null;

  // Render bounded, scoped context in a provider-native format.
  renderContext(response: ContextResponseV1): string;

  // Remove only files/managed entries owned by this connector.
  uninstall(): Promise<void>;
}
```

The sample above describes the *target interface*; the packages are not implemented.

## Connector installation acceptance

- Preserve existing user settings, JSONC comments where supported, and unrelated hooks.
- Track installed file hashes/managed markers and perform safe additive merges. A missing marker or unexpected user edit requires refusing destructive replacement.
- Config dry run must show modifications before `--apply`.
- Use the provider's current native plugin/hook mechanisms; do not rely on unofficial undocumented internals in the baseline.
- Record effective home/config root, protocol version, observed capabilities and source revision.
- Windows native and Linux/WSL environments have separate profiles and discovery files.

## OpenCode 2 integration risk

T3 spawns a local OpenCode server and supplies `OPENCODE_CONFIG_CONTENT`; plugin loading depends on the effective OpenCode 2 resolution path. Spike 0 must test the actual native V2 plugin format and lifecycle under T3. A V1 plugin is not assumed to work. Standalone OpenCode subprocess adapters are not equivalent to native in-session subagent events.

## Codex integration risk

T3 uses Codex App Server and may configure a shadow `CODEX_HOME` directory with shared skills/plugins and distinct authentication files. Spike 0 must test effective hooks, trust, subagent events and native skill lookup in that environment. No Codex OAuth token may be extracted or passed to the Harness.

## Fallback policy

If native hooks cannot observe a T3-launched runtime, the adapter may import read-only provider session histories with explicit retention and accuracy flags. A T3 telemetry export (outside the core) is a last resort and requires a new ADR with a minimal patch footprint.

