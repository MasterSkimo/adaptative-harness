import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Plugin } from "@opencode/plugin";

type Config = { sourceInstanceId: string; projectId: string; discoveryFile: string; tokenFile: string };
type NativeEvent = { type?: string; sessionID?: string; sessionId?: string; toolCallID?: string; toolUseID?: string; properties?: { info?: { id?: string } } };
type Context = { tool: { hook: (name: string, fn: (event: NativeEvent) => Promise<void>) => Promise<void> }; event: { subscribe: (options: {signal: AbortSignal}) => AsyncIterable<NativeEvent> } };
async function readJson(path: string | URL): Promise<any> { return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")); }

export default Plugin.define({
  id: "adaptive-harness",
  async setup(ctx: Context) {
    let config: Config;
    try { config = await readJson(new URL("../../adaptative-harness.json", import.meta.url)); } catch { return () => {}; }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(config.sourceInstanceId) || !/^[A-Za-z0-9_-]{8,128}$/.test(config.projectId)) return () => {};
    let pending = 0, dropped = 0, rejected = 0;
    const report = () => console.warn(`[adaptive-harness] dropped events: ${dropped}; rejected events: ${rejected}`);
    async function send(eventType: string, nativeSessionId: string, spanId?: string) {
      if (pending >= 8) { dropped++; if ((dropped & (dropped - 1)) === 0) report(); return; }
      pending++;
      try {
        const [daemon, token] = await Promise.all([readJson(config.discoveryFile), readFile(config.tokenFile, "utf8")]);
        const port = Number(daemon.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
        const now = new Date().toISOString();
        const opaque = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
        const body = {schemaVersion:1,eventId:randomUUID(),sourceInstanceId:config.sourceInstanceId,provider:"opencode",nativeSessionId:opaque(nativeSessionId),...(spanId ? {spanId:opaque(spanId)} : {}),projectId:config.projectId,eventType,occurredAt:now,observedAt:now,privacyClass:"metadata"};
        const res = await fetch(`http://127.0.0.1:${port}/v1/events`, {method:"POST",headers:{authorization:`Bearer ${token.trim()}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(250)});
        if (!res.ok) { rejected++; if ((rejected & (rejected - 1)) === 0) report(); }
      } catch { dropped++; if ((dropped & (dropped - 1)) === 0) report(); } finally { pending--; }
    }
    const hook = (type: string) => async (e: NativeEvent) => { const session = e.sessionID ?? e.sessionId; if (session) void send(type, session, e.toolCallID ?? e.toolUseID); };
    try { await ctx.tool.hook("execute.before", hook("tool.started")); await ctx.tool.hook("execute.after", hook("tool.completed")); } catch { return () => {}; }
    const controller = new AbortController();
    void (async () => { try { for await (const e of ctx.event.subscribe({signal:controller.signal})) { const id = e.properties?.info?.id; if (id && e.type === "session.created") void send("session.started", id); if (id && e.type === "session.deleted") void send("session.ended", id); } } catch { /* observation must not affect execution */ } })();
    return () => controller.abort();
  }
});

