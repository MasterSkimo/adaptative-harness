# Spike 0 — Prove provider attachment from CLI and T3 Code

**Goal:** demonstrate native connector coverage for Codex and OpenCode 2, launched directly and by T3, on Linux and Windows, **without any modification to T3 core**. This is not an implementation of learning.

Windows execution results are recorded in [Spike 0 Windows evidence](spike-0-windows-evidence.md). The report is a partial platform result; Linux, T3 Codex hook attachment, and degradation/spool checks remain open. OpenCode plugin attachment under T3 was observed on Windows.

## Preparation

1. Snapshot provider versions: `codex --version`, `opencode --version`; note T3 commit/release and provider selection.
2. Record the effective config paths: Codex `CODEX_HOME` and any shadow home; OpenCode config root and server launch environment, particularly `OPENCODE_CONFIG_CONTENT`.
3. Back up original provider hook/plugin/config files and ACLs. Use test profiles or disposable project roots; never overwrite production global configuration in the spike.
4. Create a synthetic repository containing one trivial file, a deterministic failing command and a succeeding correction; no customer source or account secrets.
5. Define a local capture endpoint that accepts **sanitized event metadata only** and timestamps/hashes. No model proxy or OAuth interception.

## Tests by entry point

### A — Codex directly

- Confirm supported native hook/plugin extension mechanism and trust/permission requirements for the actual installed version.
- Install a minimal reviewed observer at user scope; verify session started, tool start/end, stop, and child agent lifecycle where exposed.
- Confirm native skill discovery and reload semantics. Record missing fields and native event IDs.

### B — Codex via T3

- Launch the same synthetic task in T3 with the Codex provider.
- Observe whether the observer is loaded by the Codex App Server process, whether its effective `CODEX_HOME` matches the intended profile, and whether any shadow-home mappings share skills/plugins/hooks.
- Compare exact event/correlation capabilities to direct CLI. Capture T3 release/commit and adapter behavior; no source patch.

### C — OpenCode 2 directly

- Install a minimal plugin using the current OpenCode **2.x** extension format (do not reuse a 1.x bridge).
- Verify plugin startup, tool pre/post event, session and native subagent metadata, context injection capability and skill reload with a synthetic example.
- Document observed API signatures and reload behavior rather than assuming compatibility with legacy examples.

### D — OpenCode 2 via T3

- Launch OpenCode 2 from T3 and repeat C. Check inherited global/project config, `OPENCODE_CONFIG_CONTENT`, plugin loading and session event propagation.
- If plugin absent, isolate config resolution difference in a test environment. Test a non-invasive provider-native config workaround.
- Do not patch T3 orchestration; classify any remaining gap.

### E — Degradation

- Stop collector during a running agent call and verify agent completion.
- Test bounded callback timeout, spool/retry and valid recovery.
- Verify no unapproved file modification, leaked tokens or client data in captures.

## Evidence matrix template

| OS | Launcher | Provider version | Extension loaded? | Tool start/end | Child lineage | Context injection | Skills discoverable | Status |
|---|---|---|---|---|---|---|---|---|
| Linux | CLI | Record | Unknown | Unknown | Unknown | Unknown | Unknown | Pending |
| Linux | T3 | Record | Unknown | Unknown | Unknown | Unknown | Unknown | Pending |
| Windows | CLI | Record | Unknown | Unknown | Unknown | Unknown | Unknown | Pending |
| Windows | T3 | Record | Unknown | Unknown | Unknown | Unknown | Unknown | Pending |

Produce one row **per provider per OS/launcher**, plus the raw version/commit and sanitized proof. WSL 2 is a separate OS target, not implicit Windows native coverage.

## Definition of done

- Verified attachability of Codex and OpenCode 2 when launched by T3 on at least one supported target OS.
- Direct CLI comparison to establish coverage differences.
- Observer never blocks runtime when disconnected.
- Provider version/capability matrix, reproducible installer/uninstaller notes and sanitized fixture set.
- Explicit GO/NO-GO and next ADR if optional telemetry export from T3 is needed.

## Fallback ladder

1. Provider-native hook/plugin and supported callback.
2. Read-only provider-native session/event history if it meets evidence and privacy needs.
3. Optional minimal T3 event-export endpoint, **separate ADR and bounded patch**, only after native approaches fail.
4. If reliable evidence is unavailable, mark unsupported and stop learning implementation for that provider rather than misrepresenting coverage.

