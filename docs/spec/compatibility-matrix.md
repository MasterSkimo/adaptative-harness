# Provider and launcher compatibility — test matrix

**None of the combinations below is claimed verified by this repository.** Evidence is required from Spike 0, with exact versions, config roots, platform, expected and observed events.

| Runtime / launcher | Linux CLI | Linux T3 | Windows CLI | Windows T3 | Evidence |
|---|---|---|---|---|---|
| Codex (App Server path in T3) | Unknown | Unknown | Unknown | Unknown | Pending |
| OpenCode 2.x native plugin | Unknown | Unknown | Unknown | Unknown | Pending |
| Codex native hook trust | Unknown | Unknown | Unknown | Unknown | Pending |
| OpenCode 2.x plugin startup/reload | Unknown | Unknown | Unknown | Unknown | Pending |
| Child-agent correlation | Unknown | Unknown | Unknown | Unknown | Pending |
| Published skill discovery | Unknown | Unknown | Unknown | Unknown | Pending |

## Capability enumeration

Every adapter reports a \`supported | unsupported | unknown\` state plus reason/evidence for each: \`session_events\`, \`tool_before\`, \`tool_after\`, \`subagent_lifecycle\`, \`transcript_reference\`, \`context_injection\`, \`compaction\`, \`synchronous_block\`, \`skills_read\`, \`skills_write\`, \`config_reload\`.

Unknown is distinct from unsupported; do not use a feature until a local doctor proves it.

## T3-specific probes

- OpenCode server environment: compare plugin load behavior when \`OPENCODE_CONFIG_CONTENT\` is set to \`{}\` and when omitted/merged. Native OpenCode config resolution may vary with server revision.
- Codex App Server: determine effective \`CODEX_HOME\`, whether shadow-home symlinks expose global hooks/skills, hook trust mode and subagent lifecycle events.
- Compare direct CLI and T3 session provenance; do not assume same storage/profile even on same OS user.
- Never replace T3 adapter or agent orchestration code to make a probe pass.

## Source references for spike

- [T3 OpenCode server](https://github.com/pingdotgg/t3code/blob/main/packages/provider-opencode/src/server/OpenCodeRuntime.ts)
- [T3 OpenCode 2 server](https://github.com/pingdotgg/t3code/blob/main/packages/provider-opencode/src/server/v2/OpenCode2Server.ts)
- [T3 Codex adapter](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts)
- [T3 Codex shadow-home handling](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Drivers/CodexHomeLayout.ts)
- [Provider adapter contract](https://github.com/pingdotgg/t3code/blob/main/packages/provider-core/src/server/ProviderAdapter.ts)
- [OpenCode native plugin docs](https://opencode.ai/docs/plugins/)
- [Codex repository](https://github.com/openai/codex)

