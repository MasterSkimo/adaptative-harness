import { describe, it, expect, vi } from "vitest";
vi.mock("@opencode/plugin", () => ({ Plugin: { define: (plugin: unknown) => plugin } }));
vi.mock("node:fs/promises", () => ({ readFile: async (path: string | URL) => {
  const p = String(path); if (p.endsWith("adaptative-harness.json")) return JSON.stringify({sourceInstanceId:"source_test",projectId:"project_test",discoveryFile:"discovery",tokenFile:"token"});
  if (p === "discovery") return JSON.stringify({port:12345}); if (p === "token") return "token"; throw new Error("missing");
} }));
import plugin from "./plugin.js";

describe("OpenCode 2 native hook mapping", () => {
  it("correlates each call and never infers shell success", async () => {
    const callbacks = new Map<string, (event: Record<string, unknown>) => void>();
    const captured: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: {body: string}) => { captured.push(JSON.parse(init.body)); return {ok:true}; }));
    const ctx = { tool: { hook: async (name: string, cb: (e: Record<string, unknown>) => void) => { callbacks.set(name, cb); return { dispose: async () => {} }; } }, event: { subscribe: async function*() {} } };
    try {
      await plugin.setup(ctx as unknown as Parameters<typeof plugin.setup>[0]);
      const base = {sessionID:"session_test",agent:"agent_test",messageID:"message_test",tool:"shell",input:{secret:"not persisted"}};
      callbacks.get("execute.before")!({...base,id:"call_failed"});
      callbacks.get("execute.after")!({...base,id:"call_failed",status:"error",error:{message:"not persisted"}});
      callbacks.get("execute.before")!({...base,id:"call_success"});
      callbacks.get("execute.after")!({...base,id:"call_success",status:"completed",result:{output:"not persisted"}});
      await vi.waitFor(() => expect(captured).toHaveLength(4));
      expect(captured[0].spanId).toEqual(captured[1].spanId);
      expect(captured[2].spanId).toEqual(captured[3].spanId);
      expect(captured[0].spanId).not.toEqual(captured[2].spanId);
      expect(captured[1].outcome).toBe("failed");
      expect(captured[3].outcome).toBe("unknown");
      expect(JSON.stringify(captured)).not.toContain("not persisted");
    } finally { vi.unstubAllGlobals(); }
  });
});
