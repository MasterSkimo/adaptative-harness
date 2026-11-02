# Sequences and failure behavior

## Observation → asynchronous learning

```mermaid
sequenceDiagram
  participant A as Agent Runtime
  participant C as Native Connector
  participant D as Harness Daemon
  participant Q as SQLite Job Queue
  participant L as Learner
  A->>C: native tool/session event
  C->>C: redact and normalize
  C->>D: POST /v1/events (idempotent)
  alt daemon available
    D->>D: authenticate, validate, dedupe
    D-->>C: 202 accepted / 200 duplicate
    D->>Q: enqueue signal analysis
    Q->>L: lease job
    L->>L: detect evidence-backed learning signal
    L->>Q: persist candidate/evidence
  else daemon unavailable / timeout
    C->>C: bounded local spool or drop event with metric
    C-->>A: never block agent execution
  end
```

## Context resolution

```mermaid
sequenceDiagram
  participant A as Agent
  participant C as Provider Hook
  participant D as Daemon
  participant M as Memory Index
  A->>C: context hook (with user/workspace intent)
  C->>D: POST /v1/context/resolve
  alt reachable within timeout
    D->>M: project-first search + policy filters
    M-->>D: published memories with provenance
    D-->>C: bounded ordered context items
    C-->>A: inject minimal context (no executable instructions from untrusted observations)
  else timeout or failure
    C-->>A: unchanged context
  end
```

## Candidate evaluation and publication

```mermaid
sequenceDiagram
  participant L as Learner
  participant E as Evaluator
  participant R as Registry
  participant P as Publisher
  L->>R: draft candidate with evidence refs
  R->>E: evaluate candidate and baseline
  E->>E: schema/security/conflict gates
  E->>E: replay on isolated fixtures
  E->>E: regression scenarios and cost accounting
  E-->>R: signed-off result + metrics
  alt eligible and passed
    R->>R: create immutable version + release
    R->>P: publish atomically via provider-native paths
    P-->>R: installation checksums and receipts
  else failed or unknown
    R->>R: reject / quarantine, retain report
  end
```

## Crash and replay rules

Events are stored before returning an acceptance receipt. The processing cursor is represented by completed job records, not an in-memory counter. Leases expire and can be safely reacquired. A job must have a deterministic idempotency key. Crash between event insertion and enqueue is resolved by a reconciliation scan. Publishing is staged into a temporary file then atomically renamed where supported, with hashes verified before activation. Replaying a duplicate event or publication request must not generate additional releases.

