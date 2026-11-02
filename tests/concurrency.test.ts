import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

function run(main: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [main, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", x => stdout += x);
    child.stderr.setEncoding("utf8").on("data", x => stderr += x);
    child.once("error", reject);
    child.once("close", code => resolveRun({ code, stdout, stderr }));
  });
}

describe("cross-process concurrency", () => {
  it("serializes simultaneous daemon starts to one process and one credential/discovery", async () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: process.cwd(), stdio: "inherit" });
    const root = await mkdtemp(join(tmpdir(), "ah-start-race-"));
    const env = { ...process.env, LOCALAPPDATA: join(root, "state"), HOME: join(root, "state"), USERPROFILE: join(root, "state") };
    const main = resolve("dist/apps/daemon/src/main.js");
    let children: ReturnType<typeof spawn>[] = [];
    try {
      children = Array.from({ length: 2 }, () => spawn(process.execPath, [main, "start"], {cwd:root,env,stdio:"ignore"}));
      const discoveryPath = join(root, "state", ".adaptive-harness", "daemon.json");
      let discoveryFound = false;
      for (let i = 0; i < 100 && !discoveryFound; i++) { try { await readFile(discoveryPath); discoveryFound = true; } catch { await delay(100); } }
      expect(discoveryFound).toBe(true);
      await delay(1000);
      expect(children.filter(child => child.exitCode === null)).toHaveLength(1);
      const state = join(root, "state", ".adaptive-harness");
      const discovery = JSON.parse(await readFile(join(state, "daemon.json"), "utf8"));
      const token = await readFile(join(state, "token"), "utf8");
      expect(discovery.port).toBeGreaterThan(0);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect((await fetch(`http://127.0.0.1:${discovery.port}/v1/identity`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
      expect(await readFile(join(state, "token"), "utf8")).toBe(token);
    } finally {
      const statePath = join(root, "state", ".adaptive-harness");
      try {
        const d = JSON.parse(await readFile(join(statePath, "daemon.json"), "utf8"));
        const token = await readFile(join(statePath, "token"), "utf8");
        await fetch(`http://127.0.0.1:${d.port}/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
        await delay(100);
      } catch { /* startup may have failed */ }
      for (const child of children) if (child.exitCode === null) child.kill();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary directory");
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 30000);

  it("accepts a simultaneous same-event SQLite ingest once and creates one job", async () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: process.cwd(), stdio: "inherit" });
    const root = await mkdtemp(join(tmpdir(), "ah-ingest-race-"));
    try {
      const module = resolve("dist/apps/daemon/src/main.js");
      const { pathToFileURL } = await import("node:url");
      const storageUrl = pathToFileURL(resolve("dist/packages/storage/src/index.js")).href;
      const worker = `import {parentPort,workerData} from 'node:worker_threads'; import {SqliteStorage} from ${JSON.stringify(storageUrl)}; const db=new SqliteStorage(workerData.db); const barrier=workerData.barrier; Atomics.add(barrier,0,1); Atomics.notify(barrier,0); while(Atomics.load(barrier,0)<2) Atomics.wait(barrier,0,0,1000); try { parentPort.postMessage({ok:db.ingest(workerData.event).disposition}); } catch(e) { parentPort.postMessage({error:String(e)}); } finally { db.close(); }`;
      // Bundle build emits SQLite as a Node built-in and copies the migration files needed beside the bundle.
      void module;
      const { Worker } = await import("node:worker_threads");
      const db = join(root, "shared.sqlite");
      const setup = `import {SqliteStorage} from ${JSON.stringify(storageUrl)}; const s=new SqliteStorage(${JSON.stringify(db)}); s.register({sourceInstanceId:'source_race',projectId:'project_race'}); s.close();`;
      const setupFile = join(root, "setup.mjs");
      await (await import("node:fs/promises")).writeFile(setupFile, setup);
      execFileSync(process.execPath, [setupFile]);
      const event = { schemaVersion: 1, eventId: "event_race", sourceInstanceId: "source_race", provider: "opencode", nativeSessionId: "session_race", projectId: "project_race", eventType: "tool.started", occurredAt: new Date().toISOString(), observedAt: new Date().toISOString(), privacyClass: "metadata" };
      const barrier = new Int32Array(new SharedArrayBuffer(4));
      const results = await Promise.all([0, 1].map(() => new Promise<any>((resolveWorker, reject) => {
        const w = new Worker(worker, { eval: true, workerData: { db, event, barrier } });
        w.once("message", resolveWorker); w.once("error", reject);
      })));
      expect(results.map(x => x.ok).sort()).toEqual(["accepted", "duplicate"]);
      const { SqliteStorage } = await import(storageUrl);
      const inspect = new SqliteStorage(db);
      expect((inspect.db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(1);
      expect((inspect.db.prepare("SELECT count(*) AS n FROM processing_jobs").get() as { n: number }).n).toBe(1);
      inspect.close();
    } finally {
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary directory");
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 30000);
});
