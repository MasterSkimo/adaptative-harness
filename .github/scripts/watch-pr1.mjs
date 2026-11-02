// Package: repository automation (Node.js 24).
// Poll PR #1 using GitHub's API; only mechanically verifiable gates can authorize merging.
// This is NOT an AI semantic code review. It requires every original review thread resolved.
import process from 'node:process';

const REPO = 'MasterSkimo/adaptative-harness';
const [OWNER, NAME] = REPO.split('/');
const NUMBER = 1;
const MARKER = '<!-- adaptive-harness-pr1-watch -->';
const ORIGINAL_THREAD_COMMENT_IDS = new Set([
  4440976976, 4440976980, 4440976984, 4440976992,
  4440976997, 4440977018, 4440977027
]);
const WORKFLOWS = new Map([
  ['Specification validation', ['linux', 'windows']],
  ['TypeScript validation', ['typescript (ubuntu-latest)', 'typescript (windows-latest)']]
]);
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN is required for PR status checks');

async function api(path, options = {}) {
  // Never print access token, event payloads, or other sensitive HTTP request data.
  const response = await fetch('https://api.github.com' + path, {
    method: options.method ?? 'GET',
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.text();
  let data;
  try { data = payload ? JSON.parse(payload) : {}; }
  catch { data = { message: 'Non-JSON response' }; }
  if (!response.ok) throw new Error('GitHub API HTTP ' + response.status + ': ' + (data.message ?? 'Unknown error'));
  return data;
}

async function reviewThreads() {
  // A failure to read review threads is a blocking error, never a pass.
  const nodes = [];
  let cursor = null;
  for (;;) {
    const result = await api('/graphql', {
      method: 'POST',
      body: {
        query: `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
          repository(owner:$owner,name:$repo){
            pullRequest(number:$number){
              reviewThreads(first:100,after:$cursor){
                nodes{isResolved comments(first:100){nodes{databaseId}}}
                pageInfo{hasNextPage endCursor}
              }
            }
          }
        }`,
        variables: { owner: OWNER, repo: NAME, number: NUMBER, cursor }
      }
    });
    if (result.errors?.length) throw new Error('GitHub GraphQL review thread lookup failed');
    const threads = result.data?.repository?.pullRequest?.reviewThreads;
    if (!threads) throw new Error('Missing GitHub review threads (permission or schema error)');
    nodes.push(...threads.nodes);
    if (!threads.pageInfo.hasNextPage) break;
    cursor = threads.pageInfo.endCursor;
    if (!cursor || nodes.length > 1000) throw new Error('Review thread pagination safety limit exceeded');
  }
  return nodes;
}

async function workflowGate(sha) {
  // Require the TWO exact independent workflows, on the current PR head SHA.
  const data = await api('/repos/' + REPO + '/actions/runs?head_sha=' + encodeURIComponent(sha) + '&event=pull_request&per_page=100');
  const runs = data.workflow_runs ?? [];
  const blockers = [];
  for (const [workflowName, expectedJobNames] of WORKFLOWS.entries()) {
    const matched = runs.filter(r => r.name === workflowName && r.head_sha === sha)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const run = matched[0];
    if (!run) { blockers.push(workflowName + ': no run for current HEAD'); continue; }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      blockers.push(workflowName + ': ' + run.status + '/' + (run.conclusion ?? 'pending'));
      continue;
    }
    const jobsResult = await api('/repos/' + REPO + '/actions/runs/' + run.id + '/jobs?per_page=100');
    const jobs = jobsResult.jobs ?? [];
    for (const jobName of expectedJobNames) {
      const job = jobs.find(j => j.name === jobName);
      if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
        blockers.push(workflowName + ' / ' + jobName + ': not successful');
      }
    }
  }
  return blockers;
}

async function publishStatus(sha, blockers, merged = false) {
  // Maintain one status comment. Avoid sending a new notification every ten minutes.
  const state = merged ? '**Merged by scheduled gate.**' : blockers.length
    ? '**Waiting for fixes or validation.**' : '**All mechanical gates passed.**';
  const body = [
    MARKER,
    '### Automated PR #1 readiness check',
    '',
    state,
    'HEAD: `' + sha.slice(0, 12) + '`',
    '',
    ...(blockers.length ? ['Blocking conditions:', ...blockers.map(v => '- ' + v), ''] : []),
    'This is a CI/review-state gate, **not a semantic AI code review**.',
    'Required: non-draft PR, same reviewed head, green Linux/Windows CI, original review threads resolved, no active change-requested review, clean merge.',
    'When all gates pass, the workflow requests a **squash merge using the exact checked SHA**.',
    '',
    '[Workflow](https://github.com/' + REPO + '/actions/workflows/pr1-watch.yml)'
  ].join('\n');
  const comments = await api('/repos/' + REPO + '/issues/' + NUMBER + '/comments?per_page=100');
  const prior = (comments ?? []).find(c => c.body?.startsWith(MARKER) && c.user?.type === 'Bot');
  if (prior && prior.body === body) return;
  if (prior) await api('/repos/' + REPO + '/issues/comments/' + prior.id, { method: 'PATCH', body: { body } });
  else await api('/repos/' + REPO + '/issues/' + NUMBER + '/comments', { method: 'POST', body: { body } });
}

async function main() {
  const pr = await api('/repos/' + REPO + '/pulls/' + NUMBER);
  if (pr.state !== 'open' || pr.merged_at) {
    console.log('PR is closed/merged: monitor has no further work.');
    return;
  }
  const sha = pr.head.sha;
  const blockers = [];

  // The initial review was on the previous head; only newer commits are eligible.
  if (sha === 'eca0ac06242579a6dd2bbc7e640d3210300fbe2d')
    blockers.push('No commits addressing the original review yet');
  if (pr.draft) blockers.push('Pull request is still a draft');
  if (pr.mergeable !== true) blockers.push('GitHub has not confirmed a clean merge');

  const [threads, reviews, checks] = await Promise.all([
    reviewThreads(),
    api('/repos/' + REPO + '/pulls/' + NUMBER + '/reviews?per_page=100'),
    workflowGate(sha)
  ]);
  blockers.push(...checks);
  const originalSeen = new Set();
  for (const thread of threads) {
    for (const comment of thread.comments?.nodes ?? []) {
      if (ORIGINAL_THREAD_COMMENT_IDS.has(comment.databaseId)) originalSeen.add(comment.databaseId);
    }
  }
  if (originalSeen.size !== ORIGINAL_THREAD_COMMENT_IDS.size) {
    blockers.push('Cannot verify all seven original review comments / discussion threads');
  }
  const unresolved = threads.filter(t => !t.isResolved);
  if (unresolved.length) blockers.push(unresolved.length + ' unresolved code review discussion(s)');

  // GitHub's latest non-dismissed review by each account controls the status.
  const latestByReviewer = new Map();
  for (const review of reviews ?? []) {
    if (!review.user?.login || review.state === 'PENDING') continue;
    const previous = latestByReviewer.get(review.user.login);
    if (!previous || new Date(review.submitted_at) > new Date(previous.submitted_at)) {
      latestByReviewer.set(review.user.login, review);
    }
  }
  if ([...latestByReviewer.values()].some(r => r.state === 'CHANGES_REQUESTED'))
    blockers.push('A reviewer has outstanding CHANGES_REQUESTED status');

  // Don't auto-merge the still-draft prototype or misread an API failure as green.
  if (blockers.length) {
    await publishStatus(sha, blockers);
    console.log('Awaiting fixes: ' + blockers.join('; '));
    return;
  }

  // Recheck head immediately before mutation to prevent merging unseen commits.
  const fresh = await api('/repos/' + REPO + '/pulls/' + NUMBER);
  if (fresh.head.sha !== sha || fresh.draft || fresh.mergeable !== true) {
    await publishStatus(sha, ['PR head or readiness changed during review']);
    return;
  }
  try {
    const merge = await api('/repos/' + REPO + '/pulls/' + NUMBER + '/merge', {
      method: 'PUT',
      body: {
        sha,
        merge_method: 'squash',
        commit_title: 'M1: OpenCode event ingestion (#1)',
        commit_message: 'Automated squash merge after CI and review-thread gates.'
      }
    });
    if (!merge.merged) throw new Error('GitHub did not confirm merge');
    await publishStatus(sha, [], true);
    console.log('PR #1 merged at ' + merge.sha);
  } catch (error) {
    // Fail closed: keep the PR open, notify with a redacted reason.
    await publishStatus(sha, ['GitHub rejected the automatic squash merge; inspect workflow logs and repository merge policy']);
    console.error('Merge was not completed:', String(error));
    process.exitCode = 1;
  }
}
await main();
