# Delivery gates and release strategy

## Branching

Main contains the current accepted specification and eventual release-quality implementation. Use short-lived feature branches and reviewable PRs; no force push. Changes to published wire schema or SQLite migrations require a compatibility analysis and a new version/migration; never edit a migration already released in an installed version.

## Gates

- **Spec Gate:** schema tests, SQLite constraints and OpenAPI parse validation green on Linux and Windows. This tests documents, not runtime behavior.
- **Spike Gate:** observed Codex/OpenCode attachability in T3 and CLI, versioned capability matrix, no core patch and fail-open proof.
- **M1 Gate:** all relevant ingestion, privacy, memory and recovery acceptance tests; no raw transcript persistence by default.
- **M2 Gate:** replay-backed improvements; deterministic benchmark data, no regressions on protected cases, rollback, and evidence-backed publication.
- **M3 Gate:** measured false positives, guard disable/fallback, diagnostic CLI and optional T3 read-only UI.
- **Release Gate:** installation/upgrade/uninstallation on target OS, backup+restore, integrity/ACL/loopback tests, documented migration compatibility and changelog.

## Exit criteria

A feature is not ready if a callback is only supported in a direct CLI but not the documented T3 scenario, unless that limitation is named and the provider is explicitly excluded from the release target. Failed or inconclusive evaluations cannot count as promotions. If evidence is missing, halt claims, not agent execution.

## Compatibility and versioning

SemVer for the independent Harness itself; wire \`schemaVersion\` and \`protocolVersion\` evolve independently with migration and deprecation windows. Provider versions are tested against supported ranges; unsupported providers degrade to non-blocking diagnostics. Never assume T3 version == provider runtime version.

## License and governance

License selection is pending; do not copy code from third-party GPL projects into this repository without a licensing decision and review. Concepts and publicly documented APIs can be studied without copying implementation. Any public distribution must include dependency license review.

