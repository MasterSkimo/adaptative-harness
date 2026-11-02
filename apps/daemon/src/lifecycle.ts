import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { createApi } from "./api.js";
import { SqliteStorage } from "../../../packages/storage/src/index.js";

export const stateDir = join(process.env.LOCALAPPDATA ?? process.env.HOME ?? process.cwd(), ".adaptive-harness");
const discovery = join(stateDir, "daemon.json"), tokenFile = join(stateDir, "token"), lockFile = join(stateDir, "daemon.lock");
async function secureDir() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $dir=Get-Item -LiteralPath $env:AH_PRIVATE_DIR; $acl=$dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access); $acl.SetAccessRuleProtection($true,$false); foreach($r in @($acl.Access)){$acl.RemoveAccessRuleSpecific($r)}; $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); $dir.SetAccessControl($acl); $check=$dir.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access); if(!$check.AreAccessRulesProtected -or @($check.Access).Count -ne 1 -or $check.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) -ne $id){throw 'ACL verification failed'}`;
    (await import("node:child_process")).execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AH_PRIVATE_DIR: stateDir }, stdio: "ignore" });
  } else { await chmod(stateDir, 0o700); const { mode } = await (await import("node:fs/promises")).stat(stateDir); if ((mode & 0o077) !== 0) throw new Error("State directory permissions are not private"); }
}
async function verifyPrivateFile(path: string) {
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $file=Get-Item -LiteralPath $env:AH_PRIVATE_FILE; $acl=$file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access); $rules=@($acl.Access); if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) -ne $id -or $rules[0].AccessControlType -ne 'Allow' -or ($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { throw 'File ACL verification failed' }`;
    (await import("node:child_process")).execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AH_PRIVATE_FILE: path }, stdio: "ignore" });
  } else {
    const info = await (await import("node:fs/promises")).lstat(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Private file permissions failed");
  }
}
async function atomicPrivate(path: string, data: string) {
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try { await writeFile(tmp, data, { flag: "wx", mode: 0o600 }); if (process.platform !== "win32") { await chmod(tmp, 0o600); if (((await (await import("node:fs/promises")).stat(tmp)).mode & 0o077) !== 0) throw new Error("Private file permissions failed"); } await verifyPrivateFile(tmp); await rename(tmp, path); await verifyPrivateFile(path); }
  finally { await rm(tmp, { force: true }); }
}
export async function doctor() {
  try {
    const d = JSON.parse(await readFile(discovery, "utf8")) as {port:number;pid:number};
    if (!Number.isSafeInteger(d.pid) || d.pid < 1 || !Number.isSafeInteger(d.port) || d.port < 1 || d.port > 65535) return { running: false };
    const token = await readFile(tokenFile, "utf8");
    const response = await fetch(`http://127.0.0.1:${d.port}/v1/identity`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) });
    if (!response.ok || (await response.json() as {pid?:number}).pid !== d.pid) return { running: false };
    return { running: true, ...d };
  } catch { return { running: false }; }
}
export async function start() {
  await secureDir();
  const old = await doctor(); if (old.running) return old;
  let lock; try { lock = await open(lockFile, "wx", 0o600); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; const again = await doctor(); if (again.running) return again; throw new Error("Daemon startup already in progress or stale lock present"); }
  try {
    const check = await doctor(); if (check.running) return check;
    const token = randomBytes(32).toString("hex"); await atomicPrivate(tokenFile, token);
    const storage = new SqliteStorage(join(stateDir, "harness.sqlite"));
    const server = createApi(token, storage, () => { server.close(() => { storage.close(); void rm(discovery, { force: true }); }); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = (server.address() as import("node:net").AddressInfo).port;
    try { await atomicPrivate(discovery, JSON.stringify({ port, pid: process.pid })); }
    catch (error) { server.close(); storage.close(); throw error; }
    return { running: true, port, pid: process.pid };
  } finally { await lock.close(); await rm(lockFile, { force: true }); }
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
