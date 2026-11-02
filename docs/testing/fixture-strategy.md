# Fixture, replay and evaluation strategy

## Classes of fixtures

1. **Canonical contract**: sanitized synthetic JSON events and context requests, checked against schema versions.
2. **Provider captures**: opt-in redacted provider callbacks with version and launcher metadata; separate Codex CLI/App Server and OpenCode CLI/T3.
3. **Learning signals**: verified failure→repair pairs, user corrections, unsuccessful repairs and ambiguous outcomes.
4. **Evaluation tasks**: independent tasks with a deterministic pass/fail oracle and immutable starting state.
5. **Security negatives**: adversarial tool output, secret strings, cross-project identifiers, symlink traversal and duplicate payload collisions.

## Replay rules

Every fixture includes a manifest with SHA-256 digest, producer/runtime version, capture revision, OS, launcher, project ID placeholder, sensitivity classification, expected normalized event types and child-parent coverage. Provider fixtures must have sanitized metadata only. Preserve unknown/missing fields as null/absent and test that adapters do not invent values.

Never benchmark candidate skills on a test derived solely from the same candidate text; use independently scored tasks. Re-run baseline and candidate with pinned runtime settings and recorded cost, cache and timeout conditions. Mark statistically weak experiments inconclusive rather than successful.

## Test isolation

Execute third-party repo setup/test commands only in ephemeral isolated worktrees/sandboxes with allowlisted commands, no inherited credential mounts or unrestricted network. The contract test suite itself uses Python standard library SQLite in memory and synthetic fixtures; it must be safe on a developer workstation.

## Fixture privacy

Do not commit user transcripts, actual client data, access tokens, absolute workspace paths or provider credentials. Synthetic fixtures suffice until user-approved sanitization is validated. Record hashes and sanitized diagnostics for CI, not private raw traces.

