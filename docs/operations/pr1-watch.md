# PR #1 scheduled readiness watch

The repository runs `.github/workflows/pr1-watch.yml` on GitHub Actions with cron `*/10 * * * *` (every ten minutes requested; GitHub may delay or skip scheduled runs under load). It can also run via `workflow_dispatch`.

## Behavior

- Check [PR #1](https://github.com/MasterSkimo/adaptative-harness/pull/1) status and current head commit.
- Verify **both** TypeScript and specification GitHub Actions workflows have completed successfully **on that head**, with Linux and Windows jobs successful.
- Check **all seven original inline review threads exist and are resolved**; require all other review threads resolved and no active `CHANGES_REQUESTED`.
- Require PR `draft=false`, GitHub `mergeable=true`, and a newer commit than the original reviewed snapshot.
- Maintain a single PR progress comment updated only when blockers or the head change.
- When all mechanical gates pass, squash-merge PR #1 with the exact previously checked head SHA.
- After merging/closing PR #1 the workflow skips any further checks (the cron remains in the repository; remove this workflow after completion).

## Important limitation

**This is not an AI or human semantic code review.** Resolving a review thread is evidence of a declared resolution, not independent proof that the fix works. CI tests are only as complete as their assertions. To avoid false confidence, the monitor never claims to have verified test quality or runtime behavior. It cannot run an external LLM reviewer without separately configured model access, which is deliberately not present.

GitHub Actions may delay a cron trigger and repository settings may prevent `GITHUB_TOKEN` from merging (branch policies, token write access, merge method). On failure, the PR remains open and the monitor reports a blocker; it never force-merges.

## Safe operation

The scheduled workflow runs the immutable script from the default branch. It does **not** check out or execute unreviewed PR branch code with the write-enabled token. It examines status APIs and review threads, then performs an exact-SHA merge if all conditions pass.
