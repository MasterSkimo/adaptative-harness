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
```

After startup, use `status` and `doctor --provider opencode --launcher cli` to diagnose the Harness process and native callback coverage. OpenCode discovers project plugins when loading its configuration. Test direct CLI and T3-launched sessions separately; neither launcher is automatically assumed supported.

The daemon listens on an ephemeral `127.0.0.1` port. Its discovery file contains only protocol, port and PID; its bearer token is in a separate private file. Events must be sanitized before acceptance. The CLI creates a project/root registration and a source-to-project binding so arbitrary incoming project IDs do not suffice.

## Pipeline

1. Plugin emits allowlisted event metadata. If the daemon is unavailable, the event is spooled to a bounded, private file or dropped without changing the tool outcome.
2. POST `/v1/events` verifies the bearer token and project binding, performs idempotent insertion and enqueues a classification job in the same SQLite transaction.
3. A leased worker adds evidence and, where a failed tool call is followed by an observed success with the same signature in the same session, publishes a **project-local observational lesson** citing both evidence records.
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
node --experimental-strip-types apps/cli/src/main.ts candidates list --project PROJECT_ID
node --experimental-strip-types apps/cli/src/main.ts candidates propose --project PROJECT_ID --kind skill --key review --file ./SKILL.md --evidence FAILURE_ID,SUCCESS_ID
node --experimental-strip-types apps/cli/src/main.ts candidates evaluate PROPOSAL_ID
node --experimental-strip-types apps/cli/src/main.ts evaluations show EVALUATION_ID
node --experimental-strip-types apps/cli/src/main.ts releases list --project PROJECT_ID
node --experimental-strip-types apps/cli/src/main.ts releases publish PROPOSAL_ID
node --experimental-strip-types apps/cli/src/main.ts releases rollback RELEASE_ID
node --experimental-strip-types apps/cli/src/main.ts uninstall --provider opencode --scope project --root /path/to/project --apply
```

`releases publish` rejects drafts/inconclusive results. The CLI does not expose an untrusted command executor or external inference by default. A `ReplayPort` is intentionally an isolated evaluator interface, not a locally executable shell runner. Global promotion, Codex and T3 UI are not part of the OpenCode-first release.

## Verification coverage

The full [V1 test plan](../testing/v1-test-plan.md) includes Windows/Linux and CLI/T3 matrices, fault injection, privacy threats, performance targets, GUI authentication, native reload and release gates. Synthetic CI does not validate native OpenCode behavior.

- `tests/runtime.test.ts`: schema, ingested events, deduplication, source/project scopes, failure/success memory, FTS retrieval, lease recovery, authentication and request size.
- `tests/registry.test.ts`: immutable proposal deduplication, evidence isolation, fail-closed replay gate, native managed publication, rollback and loop-signature reset.
- `.github/workflows/runtime-tests.yml`: Windows and Linux Node 24 runtime suites.
- `docs/testing/acceptance.md`: production exit gates which require observed provider runs, provider versions, timing, logs and verified snapshots.

## Known gaps

- No verified full live OpenCode 2/T3 plugin test from this PR; callback coverage remains subject to runtime verification.
- Native child agent lineage, skill reload, unplug/restart spool replay, Windows ACL enforcement, and benchmark SLOs require machine evidence.
- No supplied isolated replay implementation; consequently no automatic skill/rule promotion can occur from the default configuration.
- No Codex adapter or T3 code changes (ADR-0009).
