# Linux OpenCode integration

Build and run from the repository root:

```sh
docker build --file tests/linux-opencode/Dockerfile --tag adaptive-harness-linux-test:2.2.5 .
docker run --rm --network none adaptive-harness-linux-test:2.2.5
```

The image pins `node:24-bookworm-slim` to digest `sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`, installs `@opencode/cli@2.2.5` and `pnpm@10.20.0`, and runs as the non-root `node` user. Dependencies are installed during image build; the test container has no external network.

A deterministic loopback-only OpenAI-compatible fixture returns scripted tool requests; it is not a model or a claim about model behavior. The actual OpenCode runtime loads the project plugin and executes its native read tool against a missing and an existing synthetic file. The test asserts four metadata-only events with two call spans and observed failure/unknown outcomes, then stops the daemon and confirms another real OpenCode task completes. It restarts the daemon, verifies persistence and confirms a further four events arrive. A final run stops the daemon between the first and second native tool calls: the task completes, the first call is stored and the second is dropped. Offline observations are dropped: no spool/replay is implemented. The test does not prove T3-managed, authenticated-model, native-host Linux, process-crash, or daemon interruption during an individual tool call.

CI uploads the concise synthetic test output as `linux-opencode-test-log`; it contains no credentials, transcripts or source contents. Tests requiring external model credentials are intentionally excluded.
