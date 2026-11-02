# OpenCode 2 connector (prototype)

On Windows run `install.ps1 -Project <project-directory>`. It installs `.opencode/plugins/adaptative-harness/index.ts`, refuses to overwrite a different file, and is a no-op for identical bytes. `uninstall.ps1` removes only the matching installed file. It preserves the configuration and unrelated plugins.

Create `.opencode/adaptative-harness.json` in the project:

```json
{"sourceInstanceId":"source_example","projectId":"project_example","discoveryFile":"C:/path/to/.adaptive-harness/daemon.json","tokenFile":"C:/path/to/.adaptive-harness/token"}
```

Register the source and project and start the daemon first as described in [the M1 runbook](../../../docs/operations/m1-ingestion.md). Discovery has a numeric `port`; requests always target loopback. Tool calls are observed asynchronously with a bounded 250 ms transport and no retries; event loss is possible. No input, output or prompts are sent. Native call IDs are hashed for before/after correlation. An explicit native error maps to failed; a completed tool remains unknown because it does not prove a command succeeded. This connector does not depend on T3. Child-agent relationships remain unverified.
