# V1 acceptance contract

**Status:** Proposed tests. **PASS is never implied by this document.** Collect real artifacts, versions and exact environment for each test. Requirements map to [FRs](../spec/v1-functional.md) and [NFRs](../spec/v1-non-functional.md).

## Required evidence for every test

Record test ID, UTC time, OS/build, runtime version and exact provider instance, launch method (CLI/T3), project identity, fixture and commands, result, sanitized logs, artifact hashes and links to run reports. A test is **inconclusive** if the provider offers no verified event source; it is not passed by inference.

## Acceptance cases

| ID | Priority | Scenario and expected result |
|---|---|---|
| AT-001 | P0 | Install same managed Codex/OpenCode connector twice; second run is no-op; uninstall removes only owned entries; existing hooks/config, JSONC comments and unrelated files remain unchanged |
| AT-002 | P0 | Doctor reports exact versions, effective config/home root, capabilities with evidence, and unsupported vs unknown distinctly; no config mutation |
| AT-003 | P0 | Send valid canonical fixture; receive 202 and stored sequence; event has only allowlisted sanitized metadata |
| AT-004 | P0 | Replay identical producer+event ID → 200 same sequence; same ID with changed payload → 409; unknown schema → 400 |
| AT-005 | P0 | Native child agent event maps to parent where parent ID is exposed; without evidence, parent remains null; never fabricate relation |
| AT-006 | P0 | Codex launched by direct CLI AND T3 connects to same daemon; both produce observable sessions; capabilities recorded per launcher |
| AT-007 | P0 | OpenCode 2.x launched by direct CLI AND T3 loads supported plugin and connects to daemon; version/config behavior recorded |
| AT-008 | P0 | Kill daemon before and during tool operation; native agent completes; connector bounded spool/drop and never cascades failure |
| AT-009 | P0 | Crash after event commit and before job completion; recover processing once logically despite at-least-once delivery, including a deduped re-ingest |
| AT-010 | P1 | Observed tool failure + verified repair yields a lesson proposal with references to both evidence records; no observed success yields only hypothesis |
| AT-011 | P1 | Search two memories including irrelevant one; context returns at most configured items/tokens, published only, with evidence refs; on timeout returns no extra context |
| AT-012 | P1 | Project A and B hold conflicting lessons; retrieval in A never returns private B; global promotion rejects project-specific identifiers/source |
| AT-013 | P2 | Two identical proposed skills deduplicate by logical key, scope, content digest; alternative revision forms new immutable candidate |
| AT-014 | P2 | Candidate passing trigger and regression with score improvement becomes eligible; unchanged, degraded, failed, or unverifiable candidate never auto-promotes |
| AT-015 | P2 | Publish eligible candidate into native managed path, validate content hash, observe native discovery after supported reload; rollback restores prior version |
| AT-016 | P1 | Disable inference or exhaust configured learning budget; observation and agent tasks continue; costs tracked only as estimates |
| AT-017 | P3 | Repeating identical failing command without code changes raises loop signal; tests rerun after edits do not produce false positive |
| AT-018 | P3 | Blocking disabled/unsupported capability does not block provider; enabled verified hook blocks only rule-matching test call and times out according to policy |
| AT-019 | P2 | CLI and API list project-scoped releases/evaluation provenance; unauthorized local request is rejected |
| AT-020 | P0 | Linux and Windows native: install, private credential ACL, loopback binding, path handling and uninstall; WSL is treated as separate unless explicitly registered |
| AT-021 | P0 | Run T3 with and without Harness; no T3 source changes required; deleting Harness cannot prevent T3 startup or agent execution |
| AT-022 | P1 | Inject instruction text into tool output; detector stores it as untrusted evidence and does not elevate to hook, system instruction or executable artifact |
| AT-023 | P2 | Force failure between publication staging and commit; active artifact remains previous version or recovers atomically, never torn content |
| AT-024 | P2 | Publish a valid project skill; active session remains consistent; subsequent session sees intended native version after documented reload |
| AT-025 | P0 | Request with missing/wrong bearer token denied for all data endpoints; /health reveals no project/session data |
| AT-026 | P0 | Spoof projectId in connector event/context; server rejects identity mismatch against registered source and project binding |
| AT-027 | P2 | Duplicate and out-of-order provider events do not alter terminal status or double-charge learning inference |
| AT-028 | P3 | Two providers run simultaneously against same daemon; queue fairness and SQLite writing remain consistent |

## Initial OpenCode-only release acceptance

**ADR-0009 supersedes the multi-provider release gate:** require OpenCode 2 CLI and OpenCode 2 server launched by T3, on Linux and Windows where supported. AT-006 (Codex) and the cross-provider aspect of AT-028 are **deferred, not passed**; the generic schema and optional provider enum retain their future Codex extension. AT-001 is evaluated for OpenCode only in the initial release.

## Mandatory first-release Spike 0 matrix

Test **OpenCode 2 CLI** and **OpenCode 2 server launched by T3**, on Linux and Windows where supported. For each, record session lifecycle, before-tool, after-tool, child-agent lifecycle, context delivery, skill discovery and config root. Never mark unsupported native features as failures of the learning engine; classify them as connector coverage gaps and revise adapter plans.

## Minimum exit gates by milestone

- **OpenCode Spike 0:** native OpenCode 2 plugin and context callback observed under Windows CLI and T3 (documented); complete fail-open, reload and Linux probes before release. No T3 core patch. Codex test AT-006 does not gate V1 per ADR-0009.
- **M1 (memory):** AT-001–012, 016, 020–022, 025–026 relevant to collector and memory are passing.
- **M2 (self-learning):** AT-013–015, 023–024, 027 pass with recorded baseline/candidate metrics. No executable auto-promotion.
- **M3 (guard and visibility):** AT-017–019 and 028 pass; false-positive blocking must be demonstrably bounded.
- **Release:** Linux/Windows CI, backup/restore smoke, migration upgrade paths, install/uninstall, threat-model checklist and reproducible acceptance evidence.

## Executable specification tests

`python -m unittest discover -s tests -v` exercises the *published JSON schema, OpenAPI parseability and SQLite migration constraints*. These are design-artifact validation tests and **do not** count as the provider integration or learning acceptance tests above.

