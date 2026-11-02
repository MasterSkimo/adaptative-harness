# Memory, learning, evaluation and publication specification

## Evidence-first learning

A learning signal must link to real recorded outcomes and a project. Signals: explicit user correction, reproducible tool failure followed by observed success, repeated failing calls without changed inputs, contradicted test/build claim, skill invocation with measurable regression, and project decision captured from verified context.

A model may propose a *hypothesis*, but it cannot manufacture evidence, test results or successful outcomes.

## Memory taxonomy

| Kind | Example | Minimum evidence |
|---|---|---|
| fact | Current project uses pnpm | Verified package manager/config |
| decision | Architecture accepted with rationale | Explicit decision record or clear user confirmation |
| lesson | Error E was fixed by transformation F | Failure and observed resolution correlation |
| procedure | Steps to reproduce/test a workflow | Recorded steps, verified command and outcome |

A memory is structured as title, summary, content, subject tags, scope, confidence, source evidence IDs, validity dates and owner project. Never insert entire transcript into a memory.

## Retrieval

Filter before ranking: identity and project scope, sensitivity, status, expiry, applicability, provider/tool compatibility. Rank with FTS5 BM25, evidence confidence, recency and explicit utility outcomes. Only published entries may be injected as instructions. Recorded observations are data, not trusted commands. Include citations back to stored evidence IDs and release versions. Default response: 5 entries and 600 estimated tokens; truncate by item boundaries.

## State machines

- Proposal: `draft -> evaluating -> eligible -> promoted` or `rejected/quarantined`.
- Evaluation: `pending -> running -> passed/failed/inconclusive`.
- Release: `staged -> active -> superseded` or `rolled_back/failed`.
- Job: `queued -> leased -> succeeded` or `queued/failed` (bounded retries), and `dead` after exhaustion.

Transitions must be transactionally checked; an evaluation may not promote another proposal. All writes store actor, timestamp, version and evidence.

## Evaluation gate

1. **Source integrity**: evidence exists, is deduplicated and belongs to authorized scope.
2. **Structural**: parse SKILL.md frontmatter, format/lint and check allowed paths.
3. **Security**: detect secrets, absolute customer paths, exfiltration commands and prompt-injection payloads.
4. **Conflict**: determine effective rule/skill precedence; flag contradictory instructions and duplicate logical identities.
5. **Trigger replay**: baseline and candidate run against the same frozen fixture, provider/model configuration and constraints.
6. **Regression set**: diverse passing cases, negative cases and independent tasks. Record both baselines.
7. **Decision**: candidate cannot degrade protected tests; must improve a predeclared scoring criterion. Inconclusive means reject or remain draft.

Evaluation workspaces are disposable. Tests in third-party repositories run only with configured sandbox/container isolation; they must not run on the primary working directory or gain access to private home credentials.

## Promotion

- **Project memory**: eligible if grounded, sanitized and non-conflicting.
- **Project declarative skill/rule**: eligible after trigger replay plus regression success.
- **Global memory/skill/rule**: requires independent cross-project support and removal of client-specific content; no accidental auto-crossing.
- **Executable hooks/MCP/permission changes**: forbidden auto-promotion in V1.

Publisher writes an immutable version to a staged path, verifies digest, records registry transaction, then swaps a pointer or file atomically as provider supports. Per-provider installation records detect drift. Existing user-managed files are never silently overwritten; use managed paths or a documented managed block where safe. Rollback restores the last verified release, not arbitrary git reset --hard.

## Evaluation contamination prevention

Do not use the candidate itself to grade its own behavior. Ground scores in test commands, exit codes and external assertions. Where LLM judges are used, keep their verdict supplemental and store rubric, version and token cost. Monitor live rollbacks through matched failure signatures, but never claim causal regression from a single outcome.

## Cost policy

Each inference job is associated with project budget and selected backend. Token/cost records are estimates, not provider billing truth. A budget block pauses learning jobs only; agent turns continue.

