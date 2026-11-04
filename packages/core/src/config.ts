import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, closeSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

/** One private Harness installation per OS user, independent of T3. */
export function stateRoot(){
  if(process.env.ADAPTIVE_HARNESS_HOME)return resolve(process.env.ADAPTIVE_HARNESS_HOME);
  return join(platform()==="win32"?(process.env.LOCALAPPDATA||join(homedir(),"AppData","Local")):
    (process.env.XDG_STATE_HOME||join(homedir(),".local","state")),"adaptive-harness");
}
/**
 * Windows ACLs cannot be tightened with chmod: a state root readable by other
 * local users would expose the bearer token and collected metadata.
 */
const foreignSids=["S-1-1-0","S-1-5-4","S-1-5-7","S-1-5-11","S-1-5-32-545","S-1-5-32-546"];
const verifiedRoots=new Set<string>();
function windowsPrivate(path:string):boolean{
  const script=[
    "$ErrorActionPreference='Stop'",
    "$item=Get-Item -LiteralPath $env:AH_ACL_PATH -Force",
    "if(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){exit 4}",
    "$acl=$item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)",
    "$deny=@('"+foreignSids.join("','")+"')",
    "foreach($rule in @($acl.Access)){",
    "  if($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow){continue}",
    "  $sid=$rule.IdentityReference.Value",
    "  try{$sid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}catch{}",
    "  # An unresolvable identity keeps its raw SID text and is still compared.",
    "  if($deny -contains $sid){exit 3}",
    "}",
    "exit 0"
  ].join("\n");
  const probe=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],
    {env:{...process.env,AH_ACL_PATH:path},encoding:"utf8",timeout:10000,windowsHide:true});
  // Anything other than an explicit success fails closed.
  return probe.status===0;
}
/** Fail closed when the state root is not private to the OS user. */
export function assertPrivateRoot(path:string){
  const info=statSync(path);
  if(!info.isDirectory())throw new Error("Harness state root is not a directory");
  if(platform()!=="win32"){
    if(typeof process.getuid==="function" && info.uid!==process.getuid())throw new Error("Harness state root is owned by another user");
    if((info.mode&0o077)!==0)throw new Error("Harness state root permissions are too open");
    return;
  }
  if(!windowsPrivate(path))throw new Error("Harness state root grants access to other local users; restrict its ACL or set ADAPTIVE_HARNESS_HOME to a private directory");
}
export function prepare(root=stateRoot()){
  mkdirSync(root,{recursive:true,mode:0o700});
  for(const part of ["runtime","data","spool","artifacts","backups"])mkdirSync(join(root,part),{recursive:true,mode:0o700});
  if(platform()!=="win32")chmodSync(root,0o700);
  const resolved=resolve(root);
  if(!verifiedRoots.has(resolved)){
    assertPrivateRoot(resolved);
    verifiedRoots.add(resolved);
  }
  return root;
}
export function atomicPrivate(path:string,body:string){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temp=path+"."+process.pid+".tmp";
  const fd=openSync(temp,"wx",0o600);
  try{writeFileSync(fd,body,{encoding:"utf8"});}finally{closeSync(fd);}
  renameSync(temp,path);
  if(platform()!=="win32")chmodSync(path,0o600);
}
export function token(root=stateRoot()):string {
  prepare(root);
  const path=join(root,"runtime","token");
  if(!existsSync(path)){
    // Exclusive creation ensures two processes cannot replace each other's secret.
    const fd=openSync(path,"wx",0o600);
    try{writeFileSync(fd,randomBytes(32).toString("hex"));}finally{closeSync(fd);}
  }
  if(platform()!=="win32")chmodSync(path,0o600);
  const value=readFileSync(path,"utf8").trim();
  if(!/^[0-9a-f]{64}$/.test(value))throw new Error("Invalid local credential");
  return value;
}
export interface Settings {
  schemaVersion:1;
  privacy:{rawTranscripts:false;sensitiveExcerpts:false;externalInference:boolean};
  collection:{enabled:boolean;maxEventBytes:number;spoolBytes:number};
  memory:{maxItems:number;maxTokens:number;retentionDays:number};
  learning:{enabled:boolean;maxDailyEstimatedUsd:number;inferenceBackend:"disabled"|"openai-compatible"};
  evaluation:{isolatedExecutionRequired:true};
  loopGuard:{mode:"off"|"observe"|"block";preToolTimeoutMs:number};
  transport:{host:"127.0.0.1";port:number;contextTimeoutMs:number};
}
const defaults:Settings={
  schemaVersion:1,transport:{host:"127.0.0.1",port:0,contextTimeoutMs:100},
  privacy:{rawTranscripts:false,sensitiveExcerpts:false,externalInference:false},
  collection:{enabled:true,maxEventBytes:65536,spoolBytes:10485760},
  memory:{maxItems:5,maxTokens:600,retentionDays:30},
  learning:{enabled:true,maxDailyEstimatedUsd:0,inferenceBackend:"disabled"},
  evaluation:{isolatedExecutionRequired:true},
  loopGuard:{mode:"observe",preToolTimeoutMs:30}
};
export function loadSettings(root=stateRoot()):Settings {
  const path=join(root,"config.json");
  if(!existsSync(path))return structuredClone(defaults);
  const raw=JSON.parse(readFileSync(path,"utf8"));
  const result={...structuredClone(defaults),...raw,
    privacy:{...defaults.privacy,...raw.privacy},collection:{...defaults.collection,...raw.collection},
    memory:{...defaults.memory,...raw.memory},learning:{...defaults.learning,...raw.learning},
    transport:{...defaults.transport,...raw.transport},evaluation:{...defaults.evaluation,...raw.evaluation},
    loopGuard:{...defaults.loopGuard,...raw.loopGuard}} as Settings;
  if(result.schemaVersion!==1 || result.transport.host!=="127.0.0.1" ||
      result.privacy.rawTranscripts!==false || result.privacy.sensitiveExcerpts!==false ||
      result.collection.maxEventBytes>65536 || result.collection.maxEventBytes<=0 ||
      result.transport.contextTimeoutMs>1000 || result.transport.contextTimeoutMs<=0 ||
      result.memory.maxItems>20 || result.memory.maxTokens>4096 ||
      !Number.isInteger(result.memory.retentionDays) || result.memory.retentionDays<1 || result.memory.retentionDays>3650 ||
      result.learning.maxDailyEstimatedUsd<0)throw new Error("Unsafe Harness settings");
  if(result.learning.inferenceBackend!=="disabled" && !result.privacy.externalInference)throw new Error("External inference not authorized");
  return result;
}
export interface Discovery {
  protocolVersion:1;port:number;pid:number;
  instanceId?:string;rootFingerprint?:string;
}
export function readDiscovery(root=stateRoot()):Discovery|undefined {
  try{
    const x=JSON.parse(readFileSync(join(root,"runtime","discovery.json"),"utf8")) as Discovery;
    if(x.protocolVersion!==1 || !Number.isInteger(x.port) || x.port<1 || x.port>65535 ||
       !Number.isInteger(x.pid) || x.pid<1)return undefined;
    // A copied or foreign discovery file must never redirect this installation.
    if(x.rootFingerprint!==undefined && x.rootFingerprint!==rootFingerprint(root))return undefined;
    return x;
  }catch{return undefined;}
}
/** Signal 0 probes existence; EPERM still proves the process exists. */
export function isProcessAlive(pid:number):boolean {
  try{process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code==="EPERM";}
}
export interface InstanceLock {pid:number;instanceId:string;createdAt:string;}
function readLockFile(path:string):InstanceLock|undefined {
  try{
    const value=JSON.parse(readFileSync(path,"utf8")) as InstanceLock;
    return Number.isInteger(value.pid) && value.pid>0 && typeof value.instanceId==="string"?value:undefined;
  }catch{return undefined;}
}
/**
 * One live daemon per state root. A lock left by a dead process is replaced;
 * a lock held by a live process fails closed instead of signalling a PID.
 */
export function acquireInstanceLock(path:string):InstanceLock {
  const lock:InstanceLock={pid:process.pid,instanceId:randomBytes(16).toString("hex"),createdAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++){
    try{
      const fd=openSync(path,"wx",0o600);
      try{writeFileSync(fd,JSON.stringify(lock));}finally{closeSync(fd);}
      if(platform()!=="win32")chmodSync(path,0o600);
      return lock;
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      const current=readLockFile(path);
      if(current && isProcessAlive(current.pid)){
        throw new Error("Harness daemon already running (pid "+current.pid+")");
      }
      try{unlinkSync(path);}catch{}
    }
  }
  throw new Error("Could not acquire the Harness daemon lock");
}
export function releaseInstanceLock(path:string,instanceId:string){
  const current=readLockFile(path);
  if(current && current.instanceId===instanceId)try{unlinkSync(path);}catch{}
}
export function clearStaleInstanceLock(path:string){
  const current=readLockFile(path);
  if(current && !isProcessAlive(current.pid))try{unlinkSync(path);}catch{}
}
export function sourceId(root=stateRoot()):string {
  prepare(root);
  const path=join(root,"runtime","source-id");
  if(!existsSync(path))atomicPrivate(path,"src_"+randomBytes(16).toString("hex"));
  const id=readFileSync(path,"utf8").trim();
  if(!/^src_[a-f0-9]{32}$/.test(id))throw new Error("Invalid source identity");
  return id;
}
export function rootFingerprint(root:string){return createHash("sha256").update(resolve(root)).digest("hex");}
