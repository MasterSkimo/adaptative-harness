# OpenCode 2 local Harness runtime

**Release status:** unverified until native OpenCode 2 CLI/T3 end-to-end, Linux/Windows ACL, crash-replay and child lineage acceptance evidence is attached. Unit tests are not a substitute.

## Requirements

- Node.js 24 and a local `git` binary for versioned publication.
- OpenCode 2 for native plugin integration.
- No cloud service, T3 fork modification or Docker dependency.
- The local state root is `$XDG_STATE_HOME/adaptive-harness` (Linux, falling back to `~/.local/state/adaptive-harness`) or `%LOCALAPPDATA%\\adaptive-harness` (Windows); use `ADAPTIVE_HARNESS_HOME` for an isolated installation.

## Setup

Run from the repository root:

```bash
# Tests and TypeScript checks
npm install --ignore-scripts
npm run check
npm test
npm run test:smoke

# Register an actual project root (creates only Harness-owned runtime data)
node --experimental-strip-types apps/cli/src/main.ts project register --root /path/to/project

# Preview then install a reviewed project-local OpenCode 2 plugin.
node --experimental-strip-types apps/cli/src/main.ts install --provider opencode --scope project --root /path/to/project
node --experimental-strip-types apps/cli/src/main.ts install --provider opencode --scope project --root /path/to/project --apply

# Daemon is independent of OpenCode/T3; start it in a terminal.
node --experimental-strip-types apps/cli/src/main.ts daemon start

# Stop it from another terminal through the authenticated endpoint.
node --experimental-strip-types apps/cli/src/main.ts daemon stop
```

After startup, use `status` and `doctor --provider opencode --launcher cli` to diagnose the Harness process and native callback coverage. OpenCode discovers project plugins when loading its configuration. Test direct CLI and T3-launched sessions separately; neither launcher is automatically assumed supported.

The plugin and CLI detect the launcher without extra configuration: an explicit `ADAPTIVE_HARNESS_LAUNCHER=cli|t3|other` wins, otherwise a T3 process (`T3CODE_CLI_PATH`/`T3CODE_SESSION_ID`) is recorded as `t3` and a plain OpenCode process as `cli`. Ingested events remain authoritative, so a source registered before the first callback is corrected to the observed launcher and provider version. `doctor` uses the same detection when `--launcher` is omitted.

OpenCode publishes cumulative per-session usage (`session.usage.updated`, and the session record itself). The plugin attaches the latest input/output/cache-read token counts and the estimated cost to each `turn.ended` event. The store keeps the newest snapshot per session (`session_usage`) and the overview adds it to Harness-owned external inference usage. These values are estimates, not provider billing truth.

The daemon takes `runtime/daemon.lock` before listening, so a second instance on the same state root fails without touching the live process. It listens on an ephemeral `127.0.0.1` port. Its discovery file contains only protocol, port, PID, instance ID and state-root fingerprint; its bearer token is in a separate private file. The CLI creates a project/root registration and a source-to-project binding so arbitrary incoming project IDs do not suffice.

## Pipeline

1. Plugin emits allowlisted event metadata. If the daemon is unavailable, the event is spooled to a bounded, private file or dropped without changing the tool outcome.
2. POST `/v1/events` verifies the bearer token and project binding, performs idempotent insertion and enqueues a classification job in the same SQLite transaction.
3. A leased worker adds evidence and, where a failed tool call is followed by an observed success with the same signature in the same session, records a **project-local candidate lesson** citing both evidence records. Candidates have confidence 0.5 and a retention deadline; they never enter retrieved context until an operator runs `memory publish`.
4. The context endpoint filters for published, project-scoped memory and applies item/token limits. No untrusted observation is promoted to an executable instruction.
5. Candidate `skill`/`rule` content is stored immutably and must pass structural/security checks and independent baseline/candidate fixture replay before declarative publication. Without a replay runner, the evaluation is **inconclusive** and the publisher refuses it.

## Live GUI

From a second terminal after `daemon start`:

```bash
npm run ui
# Alternative: print the one-time link without opening a browser
npm run cli -- ui --no-open
```

The daemon serves `/ui` and `/ui/api/{overview,history}` from the same `127.0.0.1` socket. The CLI authenticates with its private bearer and obtains a **60-second single-use pairing link**. After redemption, the browser receives a 2-hour `HttpOnly; SameSite=Strict; Path=/ui` session. The browser never receives the daemon's private bearer or access to `/v1/events` via its cookie.

The GUI refreshes every four seconds, with pause/manual refresh, project filtering, history pagination, and detail panels. It reports **only persisted observation metadata**; agent reasoning, uncollected operations, prompts and raw code remain invisible. Session state is lost when the daemon restarts, requiring a new `ui` link. No remote assets, external telemetry or T3 modifications.

## Candidate/release commands

```bash
node --experimental-strip-types apps/cli/src/main.ts memory search --project PROJECT_ID "Observed recovery"
node --experimental-strip-types apps/cli/src/main.ts memory list --project PROJECT_ID --status candidate
node --experimental-strip-types apps/cli/src/main.ts memory publish MEMORY_ID
node --experimental-strip-types apps/cli/src/main.ts memory archive MEMORY_ID
node --experimental-strip-types apps/cli/src/main.ts candidates list --project PROJECT_ID
node --experimental-strip-types apps/cli/src/main.ts candidates propose --project PROJECT_ID --kind skill --key review --file ./SKILL.md --evidence FAILURE_ID,SUCCESS_ID
node --experimental-strip-types apps/cli/src/main.ts candidates evaluate PROPOSAL_ID
node --experimental-strip-types apps/cli/src/main.ts evaluations show EVALUATION_ID
node --experimental-strip-types apps/cli/src/main.ts releases list --project PROJECT_ID
node --experimental-strip-types apps/cli/src/main.ts releases publish PROPOSAL_ID
node --experimental-strip-types apps/cli/src/main.ts releases rollback RELEASE_ID
node --experimental-strip-types apps/cli/src/main.ts uninstall --provider opencode --scope project --root /path/to/project --apply
```

`releases publish` rejects drafts/inconclusive results. It reserves a staged
release before touching managed files, restores the previous verified bytes if a
step fails, and finishes an interrupted attempt from its staged release on retry.
`releases rollback` resumes safely after a crash and is idempotent. The CLI does
not expose an untrusted command executor or external inference by default. A
`ReplayPort` is intentionally an isolated evaluator interface, not a locally
executable shell runner. Global promotion, Codex and T3 UI are not part of the
OpenCode-first release.

## Verification coverage

The full [V1 test plan](../testing/v1-test-plan.md) includes Windows/Linux and CLI/T3 matrices, fault injection, privacy threats, performance targets, GUI authentication, native reload and release gates. Synthetic CI does not validate native OpenCode behavior.

- `tests/runtime.test.ts`: schema, ingested events, deduplication, source/project scopes, candidate lesson promotion/archival, FTS retrieval, lease recovery, daemon lock, automatic ticker drain, authenticated stop, discovery ownership, state-root ACL/retention checks, authentication and request size.
- `tests/registry.test.ts`: immutable proposal deduplication, evidence isolation, secret/private-path heuristics, fail-closed replay gate, two-phase publication with crash resume, rollback resume, loop-signature reset.
- `.github/workflows/runtime-tests.yml`: Windows and Linux Node 24 runtime suites.
- `docs/testing/acceptance.md`: production exit gates which require observed provider runs, provider versions, timing, logs and verified snapshots.

## Known gaps

- No verified full live OpenCode 2/T3 plugin test from this PR; callback coverage remains subject to runtime verification.
- Native child agent lineage, skill reload, unplug/restart spool replay, state-root ACL acceptance on each release machine, and benchmark SLOs require machine evidence.
- No supplied isolated replay implementation; consequently no skill/rule publication can occur from the default configuration. Heuristic lessons likewise require an explicit `memory publish`.
- No Codex adapter or T3 code changes (ADR-0009).

## OpenCode 2 execution lifecycle (T3 and CLI)

In OpenCode 2 the native `session.execution.started/succeeded/failed/interrupted` notifications describe an **execution**, not the end of the reusable conversation. The connector maps them to `turn.started/turn.ended`, while only `session.deleted` closes the session itself. `session.idle` is a compatibility fallback for older provider versions, never an irreversible session deletion.

The GUI's Sessions table shows **Conversation** and **Exécution** separately. A finished execution is `Terminée` and its still-open session is `En attente`. Previously collected sessions without a native execution lifecycle are `Non observées`, not assumed to be running or completed. Existing records cannot be retroactively inferred from uncollected provider events.

After pulling the latest branch, **stop T3/OpenCode, stop the Harness daemon, upgrade the project plugin with a preview, then restart**:

```bash
npm run cli -- daemon stop
npm run cli -- install --provider opencode --scope project --root /path/to/project
npm run cli -- install --provider opencode --scope project --root /path/to/project --apply
npm run start
# In a second shell:
npm run ui
```

The installer updates an **exact unmodified previous plugin version**, but refuses to overwrite locally edited or unknown content. The daemon applies migrations through 0005 on startup. Start a **new execution** in T3 after restarting; the new execution events, not old idle sessions, are what prove the fix. Native T3 testing remains an acceptance requirement; synthetic CI callback playback is not a live provider test.

## Diagnosing launcher, execution state and token usage

- **Launcher `unknown`**: register a project or emit one event after upgrading the plugin. Explicit `ADAPTIVE_HARNESS_LAUNCHER` wins; otherwise T3 is detected from `T3CODE_*` and plain OpenCode from `OPENCODE*`. Ingested event metadata is authoritative and refreshes a source that was registered earlier as `unknown`.
- **Conversation `Inconnu` / execution `Non observé`**: no `session_execution_state` row exists. OpenCode 2 bus events carry their identity under `data.sessionID` (tool hooks use `sessionID` directly); an adapter that only reads the hook shape silently drops every `session.*` event. Check that `events.event_type` contains `turn.started`/`turn.ended`, not only tool events.
- **Tokens `0 / 0`**: usage is attached to each `turn.ended` from the cumulative session record. A history with only tool events predates usage capture; a new execution populates `session_usage`. The overview adds this observed usage to Harness-owned external inference, and both are estimates.
