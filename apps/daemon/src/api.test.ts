import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApi } from "./api.js";
import type { Server } from "node:http";
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });
const event = () => ({ schemaVersion: 1, eventId: randomUUID(), sourceInstanceId: "source_123", provider: "opencode", nativeSessionId: "session-123", projectId: "project_123", eventType: "tool.started", occurredAt: new Date().toISOString(), observedAt: new Date().toISOString(), privacyClass: "metadata" });
async function start(ingest: (e: unknown) => {disposition: "accepted" | "duplicate"; sequence: number}) {
  server = createApi("secret-token", { ingest }); await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address(); if (!addr || typeof addr === "string") throw new Error("no address"); return `http://127.0.0.1:${addr.port}`;
}
describe("local ingestion HTTP", () => {
  it("authenticates, validates, accepts and deduplicates", async () => {
    let calls = 0; const url = await start(() => ({ disposition: calls++ ? "duplicate" : "accepted", sequence: 1 })); const e = event();
    const post = (body: unknown, auth = "Bearer secret-token") => fetch(url + "/v1/events", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await fetch(url + "/health")).status).toBe(200);
    expect((await post(e, "Bearer invalid")).status).toBe(401);
    expect((await post({...e, metadata: { prompt: "secret" }})).status).toBe(400);
    expect((await post(e)).status).toBe(202); expect((await post(e)).status).toBe(200);
    expect((await post({...e, padding: "x".repeat(65536)})).status).toBe(413);
  });
  it.each([["FORBIDDEN",403], ["CONFLICT",409], ["OTHER",503]] as const)("maps %s errors to %s", async (code, status) => {
    const url = await start(() => { throw Object.assign(new Error("private"), {code}); });
    const response = await fetch(url + "/v1/events", {method:"POST",headers:{authorization:"Bearer secret-token","content-type":"application/json"},body:JSON.stringify(event())});
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("private");
  });
});
