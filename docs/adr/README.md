# Architecture decision records

Status convention: **Accepted** = target architecture (subject to Spike 0 feasibility); **Proposed** = pending measurement; **Superseded** = retained history. These are design decisions, not evidence that components are implemented.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-independent-companion.md) | Independent learning companion; no T3 core dependency | Accepted |
| [0002](0002-provider-native-connectors.md) | Native connectors before protocol interception | Accepted |
| [0003](0003-local-daemon-transport.md) | Shared local daemon and loopback HTTP | Accepted |
| [0004](0004-sqlite-and-artifacts.md) | SQLite + versioned assets, FTS5 first | Accepted |
| [0005](0005-evidence-gated-promotion.md) | Evidence-gated automated promotion | Accepted |
| [0006](0006-fail-open-and-loop-guard.md) | Fail-open learning path, bounded guard | Accepted |
| [0007](0007-inference-abstraction.md) | Replaceable LLM inference, no traffic proxy | Accepted |
| [0008](0008-project-isolation.md) | Project-scoped learning and restricted globalization | Accepted |
| [0009](0009-opencode-first-release.md) | Deliver OpenCode 2 first; defer Codex until native T3 attachment is evidenced | Accepted |

