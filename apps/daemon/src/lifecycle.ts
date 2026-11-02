import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createApi } from "./api.js";
import { SqliteStorage } from "../../../packages/storage/src/index.js";

export const stateDir = join(process.env.LOCALAPPDATA ?? process.env.HOME ?? process.cwd(), ".adaptive-harness");
const discovery = join(stateDir, "daemon.json"), tokenFile = join(stateDir, "token"), pidFile = join(stateDir, "daemon.pid");
async function secureDir() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$dir = Get-Item -LiteralPath $env:AH_PRIVATE_DIR
$acl = $dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
$dir.SetAccessControl($acl)
`;
    (await import("node:child_process")).execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AH_PRIVATE_DIR: stateDir }, stdio: "ignore" });
  } else await chmod(stateDir, 0o700);
}
export async function start() {
  await secureDir();
  const old = await doctor(); if (old.running) return old;
  const token = randomBytes(32).toString("hex"); await writeFile(tokenFile, token, { mode: 0o600 });
  const storage = new SqliteStorage(join(stateDir, "harness.sqlite"));
  const server = createApi(token, storage, () => { server.close(() => { storage.close(); void rm(discovery, { force: true }); }); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  try { await writeFile(discovery, JSON.stringify({ port, pid: process.pid }), { mode: 0o600 }); await writeFile(pidFile, String(process.pid), { mode: 0o600 }); } catch (error) { await new Promise<void>(resolve => server.close(() => resolve())); storage.close(); await rm(discovery, {force: true}); throw error; }
  return { running: true, port, pid: process.pid };
}
export async function doctor() {
  try { const d = JSON.parse(await readFile(discovery, "utf8")) as {port:number;pid:number}; process.kill(d.pid, 0); return { running: true, ...d }; }
  catch { return { running: false }; }
}
export async function stop() {
  const d = await doctor(); if (!("port" in d) || !d.running) return { running: false };
  const token = await readFile(tokenFile, "utf8");
  const response = await fetch(`http://127.0.0.1:${d.port}/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new Error("Cannot authenticate daemon shutdown");
  return { running: false };
}
export async function register(sourceInstanceId: string, projectId: string) {
  await secureDir(); const db = new SqliteStorage(join(stateDir, "harness.sqlite"));
  try { db.register({ sourceInstanceId, projectId }); } finally { db.close(); }
}







