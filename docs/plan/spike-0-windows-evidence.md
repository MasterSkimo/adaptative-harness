# Spike 0 Windows evidence

**Status:** Partial execution; not a Spike 0 GO decision.
**Date:** 2026-11-02.
**Platform:** Windows 11 x64, build 26200.
**Fixture:** disposable Git repository under `%TEMP%`; synthetic text file and local Node scripts only. No customer source or tokens were captured.

## Environment

| Component | Observed version/configuration |
|---|---|
| Codex CLI | `codex-cli 0.166.0`; `CODEX_HOME` unset (default `C:\Users\gutim\.codex`) |
| OpenCode | `v2.2.5`; `OPENCODE_CONFIG` and `OPENCODE_CONFIG_CONTENT` unset; default config root `C:\Users\gutim\.config\opencode` |
| T3 Code | File/product version `0.1.6`; no release commit mapping was found |
| T3 Codex provider | Provider settings show binary `codex`, `CODEX_HOME ~/.codex`, shadow home `~/.codex-t3/personal`; process tree showed Codex CLI and App Server processes. Effective child environment was not independently read. |
| T3 OpenCode provider | Provider settings show OpenCode `v2.2.5`, authenticated, binary `opencode`, local server URL `http://127.0.0.1:4096`; the fixture's project plugin loaded, but global config inheritance and the actual `OPENCODE_CONFIG_CONTENT` value were not independently verified. |

The direct CLI probes used project-local extension files in the disposable fixture. Global provider configuration and authentication files were not changed. Codex hooks were enabled in the fixture, and the direct invocation used Codex's documented hook-trust bypass flag for this synthetic project.

## Results

| Provider / launcher | Result | Evidence |
|---|---|---|
| Codex CLI | Pass for project-level hook delivery and skill discovery | Across two direct runs, 37 sanitized rows: `SessionStart` 2, `PreToolUse` 16, `PostToolUse` 15, `Stop` 2, `SubagentStart` 1, `SubagentStop` 1. The synthetic skill was discovered; child agent read `README.md`; `fixture.txt` ended as `correct`. |
| Codex via T3 | Partial; execution and child task completed, attachment not demonstrated | The synthetic T3 task completed and repaired `fixture.txt`. The project hook collector received no additional Codex events for this task. T3's configured shadow home was visible in settings, but effective `CODEX_HOME`, trust mapping, and hook lookup for the launched process were not independently confirmed. |
| OpenCode CLI | Pass for plugin startup, tool hooks, context injection, and skill discovery | 108 sanitized rows, including `plugin.setup` 1, `tool.before` 6, `tool.after` 6, and `context.injected` 7. Tools included `skill`, `shell`, `read`, and `patch`. Synthetic task passed and `fixture.txt` ended as `correct`. Native subagent lineage and skill reload behavior were not tested. |
| OpenCode via T3 | Pass for project plugin startup, tool hooks, context injection, and skill discovery; partial overall | The final run used T3's OpenCode provider with `openai/gpt-6-luna` against the disposable project. The project skill loaded, `node fail.mjs` exited 1 as expected, only `fixture.txt` changed, and `node verify.mjs` succeeded. The collector received 193 OpenCode rows during the T3 run, including 12 `tool.before`, 12 `tool.after`, 10 `context.injected`, and 1 `plugin.setup`. A T3 child task read `README.md`, but the native OpenCode capture did not expose a parent-child correlation field. `OPENCODE_CONFIG_CONTENT` was not independently inspected and skill reload was not tested. |

The T3 Codex UI run began with `fixture.txt` already correct from the direct test. It reported that precondition, set the fixture temporarily to `incorrect`, confirmed the failure, restored `correct`, and passed `verify.mjs`. The final T3 OpenCode run began with the fixture set to `incorrect` and changed only `fixture.txt` to `correct`. One earlier T3 OpenCode attempt reached the free model's usage limit. A subsequent exploratory thread inherited the main repository and read only its `README.md`; it made no changes. The final run used `t3_thread_launch` with the fixture project bound explicitly. The final synthetic state is correct.

## Capture and degradation

The loopback collector stored 338 rows total: 37 Codex and 301 OpenCode (108 direct CLI plus 193 during the T3 run). Its stored keys were limited to event/source/category/tool names, hashes, timestamp, and a whitelist-key list (`event`, `source`, `category`, `tool`, `sessionHash`, `turnHash`, `callHash`, `receivedAt`, `keys`). No payload, command text, path, transcript, token, or credential field was present in the captured records.

Hook callbacks used a 900 ms client timeout and a 2 second hook timeout. Agent completion with the collector stopped, bounded timeout behavior under load, durable spool/retry, and recovery were not tested. The collector was stopped after capture. The fixture remains outside the repository in the system temporary directory.

## Remaining work

- Run the Linux CLI and T3 rows, treating WSL as a separate target if used.
- Repeat T3 Codex with effective environment and hook/trust resolution captured without reading credential contents.
- Inspect T3 OpenCode's effective `OPENCODE_CONFIG_CONTENT` and inherited config resolution without reading credentials.
- Test collector outage, bounded fail-open behavior, spool/retry and recovery.
- Test OpenCode native subagent lineage and skill reload semantics.

No production implementation or architecture decision follows from this partial run. Revisit the T3 attachment hypothesis after the remaining checks; do not treat direct CLI coverage as proof of T3 coverage.
