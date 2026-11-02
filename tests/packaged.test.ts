import { describe, it, expect } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

describe("packaged daemon", () => {
  it("registers, starts and stops outside the repository", async () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: process.cwd() });
    const root = await mkdtemp(join(tmpdir(), "ah-dist-test-"));
    const env = { ...process.env, LOCALAPPDATA: join(root,"state"), HOME: join(root,"state"), USERPROFILE: join(root,"state") };
    const main = join(root,"dist","apps","daemon","src","main.js");
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await cp("dist", join(root,"dist"), { recursive: true });
      execFileSync(process.execPath, [main,"register","source_build","project_build"], { cwd: root, env });
      const stateDir = join(root,"state",".adaptive-harness");
      await writeFile(join(stateDir,"daemon.json"), JSON.stringify({pid:process.pid,port:1}));
      await writeFile(join(stateDir,"token"), "stale");
      const stale = JSON.parse(execFileSync(process.execPath,[main,"doctor"],{cwd:root,env,encoding:"utf8"}));
      expect(stale.running).toBe(false);
      child = spawn(process.execPath, [main,"start"], { cwd: root, env, stdio: "ignore" });
      const discovery = join(root,"state",".adaptive-harness","daemon.json");
      let port = 0;
      for (let i = 0; i < 100 && !port; i++) {
        if (child.exitCode !== null) throw new Error(`daemon exited: ${child.exitCode}`);
        try { const current = JSON.parse(await readFile(discovery,"utf8")); if (current.port !== 1) port = current.port; else await delay(100); } catch { await delay(100); }
      }
      expect(port).toBeGreaterThan(0);
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      execFileSync(process.execPath, [main,"stop"], { cwd: root, env });
      await new Promise<void>((resolveExit, reject) => { if (child!.exitCode !== null) return resolveExit(); const timer = setTimeout(() => reject(new Error("daemon did not stop")), 5000); child!.once("exit", () => { clearTimeout(timer); resolveExit(); }); });
    } finally {
      if (child && child.exitCode === null) child.kill();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary directory");
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 20000);
});
