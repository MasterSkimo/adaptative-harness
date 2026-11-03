import { randomBytes, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, closeSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

/** One private Harness installation per OS user, independent of T3. */
export function stateRoot(){
  if(process.env.ADAPTIVE_HARNESS_HOME)return resolve(process.env.ADAPTIVE_HARNESS_HOME);
  return join(platform()==="win32"?(process.env.LOCALAPPDATA||join(homedir(),"AppData","Local")):
    (process.env.XDG_STATE_HOME||join(homedir(),".local","state")),"adaptive-harness");
}
export function prepare(root=stateRoot()){
  mkdirSync(root,{recursive:true,mode:0o700});
  for(const part of ["runtime","data","spool","artifacts","backups"])mkdirSync(join(root,part),{recursive:true,mode:0o700});
  if(platform()!=="win32")chmodSync(root,0o700);
  // On Windows, refuse non-private ACLs; the user must provision the data root privately.
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
  evaluation:{isolatedExecutionRequired:true;autoPromoteDeclarative:boolean};
  loopGuard:{mode:"off"|"observe"|"block";preToolTimeoutMs:number};
  transport:{host:"127.0.0.1";port:number;contextTimeoutMs:number};
}
const defaults:Settings={
  schemaVersion:1,transport:{host:"127.0.0.1",port:0,contextTimeoutMs:100},
  privacy:{rawTranscripts:false,sensitiveExcerpts:false,externalInference:false},
  collection:{enabled:true,maxEventBytes:65536,spoolBytes:10485760},
  memory:{maxItems:5,maxTokens:600,retentionDays:30},
  learning:{enabled:true,maxDailyEstimatedUsd:0,inferenceBackend:"disabled"},
  evaluation:{isolatedExecutionRequired:true,autoPromoteDeclarative:true},
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
      result.learning.maxDailyEstimatedUsd<0)throw new Error("Unsafe Harness settings");
  if(result.learning.inferenceBackend!=="disabled" && !result.privacy.externalInference)throw new Error("External inference not authorized");
  return result;
}
export function readDiscovery(root=stateRoot()):{protocolVersion:number;port:number;pid:number}|undefined {
  try{
    const x=JSON.parse(readFileSync(join(root,"runtime","discovery.json"),"utf8"));
    if(x.protocolVersion!==1 || !Number.isInteger(x.port) || x.port<1 || x.port>65535)return undefined;
    return x;
  }catch{return undefined;}
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
