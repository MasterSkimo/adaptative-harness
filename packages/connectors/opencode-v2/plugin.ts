import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Plugin } from "@opencode/plugin";

type Config = { sourceInstanceId: string; projectId: string; discoveryFile: string; tokenFile: string };
async function readJson(path: string | URL): Promise<unknown> { return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as unknown; }

export default Plugin.define({
  id: "adaptive-harness",
  async setup(ctx) {
    let config: Config;
    try { const raw = await readJson(new URL("../../adaptative-harness.json", import.meta.url)); if (!raw || typeof raw !== "object") return () => {}; const c = raw as Record<string, unknown>; if (typeof c.sourceInstanceId !== "string" || typeof c.projectId !== "string" || typeof c.discoveryFile !== "string" || typeof c.tokenFile !== "string") return () => {}; config = { sourceInstanceId: c.sourceInstanceId, projectId: c.projectId, discoveryFile: c.discoveryFile, tokenFile: c.tokenFile }; } catch { return () => {}; }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(config.sourceInstanceId) || !/^[A-Za-z0-9_-]{8,128}$/.test(config.projectId)) return () => {};
    let pending = 0, dropped = 0, rejected = 0;
    const report = () => console.warn(`[adaptive-harness] dropped events: ${dropped}; rejected events: ${rejected}`);
    async function send(eventType: string, nativeSessionId: string, spanId?: string, toolName?: string, outcome?: "failed" | "unknown") {
      if (pending >= 8) { dropped++; if ((dropped & (dropped - 1)) === 0) report(); return; }
      pending++;
      try {
        const [daemon, token] = await Promise.all([readJson(config.discoveryFile), readFile(config.tokenFile, "utf8")]);
        const port = Number((daemon as {port?: unknown})?.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
        const now = new Date().toISOString();
        const opaque = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
        const body = {schemaVersion:1,eventId:randomUUID(),sourceInstanceId:config.sourceInstanceId,provider:"opencode",nativeSessionId:opaque(nativeSessionId),...(spanId ? {spanId:opaque(spanId)} : {}),projectId:config.projectId,eventType,occurredAt:now,observedAt:now,privacyClass:"metadata",...(outcome ? {outcome} : {}),...(toolName && /^[A-Za-z0-9_.:-]{1,128}$/.test(toolName) ? {metadata:{toolName}} : {})};
        const res = await fetch(`http://127.0.0.1:${port}/v1/events`, {method:"POST",headers:{authorization:`Bearer ${token.trim()}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(250)});
        if (!res.ok) { rejected++; if ((rejected & (rejected - 1)) === 0) report(); }
      } catch { dropped++; if ((dropped & (dropped - 1)) === 0) report(); } finally { pending--; }
    }
    try {
      await ctx.tool.hook("execute.before", e => { void send("tool.started", e.sessionID, e.id, e.tool); });
      await ctx.tool.hook("execute.after", e => { void send("tool.completed", e.sessionID, e.id, e.tool, e.status === "error" ? "failed" : "unknown"); });
    } catch { return () => {}; }
    const controller = new AbortController();
    void (async () => { try { for await (const e of ctx.event.subscribe({signal:controller.signal})) { const v = e as unknown as { type?: string; properties?: { info?: { id?: string } } }; const id = v.properties?.info?.id; if (id && v.type === "session.created") void send("session.started", id); if (id && v.type === "session.deleted") void send("session.ended", id); } } catch { /* observation must not affect execution */ } })();
    return () => controller.abort();
  }
});
