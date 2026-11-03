#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Daemon } from "../../daemon/src/server.ts";
import { Store } from "../../../packages/storage/src/store.ts";
import { atomicPrivate, prepare, readDiscovery, sourceId, stateRoot } from "../../../packages/core/src/config.ts";
import { request } from "../../../packages/core/src/client.ts";
import { Registry } from "../../../packages/core/src/registry.ts";

const argv=process.argv.slice(2);
const command=argv[0]||"help";
const flag=(name:string)=>{const i=argv.indexOf("--"+name);return i>=0?argv[i+1]:undefined;};
const has=(name:string)=>argv.includes("--"+name);
const root=stateRoot();
const info=(value:unknown)=>console.log(typeof value==="string"?value:JSON.stringify(value,null,2));
const fileHash=(v:string)=>createHash("sha256").update(v).digest("hex");
const mapping=join(root,"runtime","projects.json");
const dbPath=join(root,"data","harness.sqlite");
const pluginSource=new URL("../../../packages/connectors/opencode/plugin/index.ts",import.meta.url);
function store(){return new Store(dbPath);}
function ensureProvider(){
  const provider=flag("provider")||"opencode";
  if(provider!=="opencode")throw new Error("Codex connector deferred by ADR-0009");
}
function sourceMap():Record<string,string>{
  try{return JSON.parse(readFileSync(mapping,"utf8")) as Record<string,string>;}catch{return {};}
}
function registerProject(path:string){
  const actual=realpathSync(resolve(path));
  prepare(root);
  const s=store();
  try{
    const projectId=s.registerProject(actual,basename(actual));
    s.bindSource(sourceId(root),projectId);
    const m=sourceMap();m[fileHash(actual)]=projectId;
    atomicPrivate(mapping,JSON.stringify(m));
    return {projectId,root:actual};
  }finally{s.close();}
}
function pluginTarget(scope:string,path:string){
  if(scope==="user")return join(homedir(),".config","opencode","plugins","adaptive-harness","index.ts");
  if(scope==="project")return join(realpathSync(resolve(path)),".opencode","plugins","adaptive-harness","index.ts");
  throw new Error("Scope must be user or project");
}
function install(remove=false){
  ensureProvider();
  const scope=flag("scope")||"project";
  const path=flag("root")||process.cwd();
  const target=pluginTarget(scope,path);
  const content=readFileSync(pluginSource,"utf8");
  const current=existsSync(target)?readFileSync(target,"utf8"):undefined;
  const ours=(current===undefined || current===content);
  if(!ours)throw new Error("Refusing to overwrite/delete a user-modified plugin at "+target);
  const changes=current===undefined?"create":current===content?"none":"replace";
  const plan={provider:"opencode",scope,target,operation:remove?(current?"remove":"none"):changes,warnings:[] as string[]};
  if(!has("apply"))return info(plan); // dry-run by default
  if(remove){
    if(current!==undefined)rmSync(target);
    return info({...plan,applied:true});
  }
  if(scope==="project")registerProject(path);
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  if(current===undefined)writeFileSync(target,content,{flag:"wx",mode:0o600});
  info({...plan,applied:true});
}
function doctor(){
  ensureProvider();
  const probe=spawnSync("opencode",["--version"],{encoding:"utf8",timeout:2000,shell:false});
  const providerVersion=probe.error?"unknown":(probe.stdout||probe.stderr).trim();
  let observed:Record<string,unknown>={};
  try{observed=JSON.parse(readFileSync(join(root,"runtime","capabilities-opencode.json"),"utf8"));}
  catch{}
  const name=flag("launcher")||"unknown";
  const supported=new Set(Array.isArray(observed.observed)&&observed.launcher===name?observed.observed:[]);
  const kinds=["session_events","tool_before","tool_after","subagent_lifecycle","transcript_reference",
    "context_injection","compaction","synchronous_block","skills_read","skills_write","config_reload"];
  const capabilities=Object.fromEntries(kinds.map(k=>[k,{status:supported.has(k)?"supported":"unknown",
    observedAt:supported.has(k)?observed.at:null,providerVersion,launcher:name,os:process.platform}]));
  // An explicit absence of verified blocking means the plugin never blocks.
  capabilities.synchronous_block.status="unsupported";
  info({provider:"opencode",providerVersion,launcher:name,sourceInstanceId:existsSync(join(root,"runtime","source-id"))?sourceId(root):null,
    daemon:readDiscovery(root)??null,capabilities});
}
async function main(){
  switch(command){
    case "project":{
      if(argv[1]!=="register")throw new Error("Expected project register");
      const path=flag("root");
      if(!path)throw new Error("--root required");
      info(registerProject(path));break;
    }
    case "install":install();break;
    case "uninstall":install(true);break;
    case "doctor":doctor();break;
    case "daemon":{
      if(argv[1]==="start"){
        const daemon=new Daemon(root);
        const port=await daemon.start();
        info({status:"started",protocolVersion:1,port});
        let closing=false;
        const stop=()=>{if(closing)return;closing=true;void daemon.stop().then(()=>process.exit(0));};
        process.once("SIGINT",stop);process.once("SIGTERM",stop);
      }else if(argv[1]==="stop"){
        const state=readDiscovery(root);
        if(!state)throw new Error("No running daemon");
        process.kill(state.pid,"SIGTERM");
        info({status:"stop-requested",pid:state.pid});
      }else throw new Error("Expected daemon start|stop");
      break;
    }
    case "ui":{
      // A one-time pairing URL authorizes only the read-only UI for two hours.
      const pairing=await request("/v1/ui/pair","POST",{},root,1000);
      if(!has("no-open")){
        const launcher=process.platform==="win32"?"rundll32.exe":process.platform==="darwin"?"open":"xdg-open";
        const args=process.platform==="win32"?["url.dll,FileProtocolHandler",pairing.url]:[pairing.url];
        const child=spawn(launcher,args,{detached:true,stdio:"ignore"});
        child.on("error",()=>{}); // Missing browser opener must not affect Harness or CLI.
        child.unref();
      }
      info({url:pairing.url,expiresInSeconds:pairing.expiresInSeconds,
        message:"One-time local UI link. The browser receives a read-only session, not the Harness bearer token."});
      break;
    }
    case "status":{
      let status:unknown={daemon:"offline"};
      try{status=await request("/v1/status");}catch{}
      info(status);break;
    }
    case "memory":{
      if(argv[1]!=="search")throw new Error("Expected memory search");
      const project=flag("project"),query=argv.slice(argv.indexOf("search")+1).filter(x=>!x.startsWith("--")&&x!==project).join(" ");
      if(!project || !query)throw new Error("Expected --project ID and QUERY");
      const result=await request("/v1/context/resolve","POST",{schemaVersion:1,provider:"opencode",
        sourceInstanceId:sourceId(root),projectId:project,nativeSessionId:"cli-search",
        query,maxItems:5,maxTokens:600},root,1000);
      info(result);break;
    }
    case "candidates":{
      if(argv[1]==="list"){
        const project=flag("project");if(!project)throw new Error("--project required");
        const s=store();try{info(s.all("SELECT id,kind,status,candidate_digest,created_at FROM proposals WHERE project_id=? ORDER BY created_at DESC LIMIT 100",project));}finally{s.close();}
      }else if(argv[1]==="propose"){
        const project=flag("project"),kind=flag("kind"),key=flag("key"),path=flag("file"),evidence=flag("evidence");
        if(!project||!path||!key||!evidence||(kind!=="skill"&&kind!=="rule"))throw new Error("Expected --project --kind skill|rule --key --file --evidence id1,id2");
        const s=store();
        try{info({proposalId:new Registry(s,root).propose({projectId:project,kind,logicalKey:key,
          content:readFileSync(path,"utf8"),evidenceIds:evidence.split(",")})});}finally{s.close();}
      }else if(argv[1]==="evaluate"&&argv[2]){
        const s=store();try{info({evaluationId:await new Registry(s,root).evaluate(argv[2])});}finally{s.close();}
      }else throw new Error("Expected candidates list|propose|evaluate");
      break;
    }
    case "evaluations":{
      if(argv[1]!=="show"||!argv[2])throw new Error("Expected evaluations show ID");
      const s=store();try{info(s.get("SELECT * FROM evaluations WHERE id=?",argv[2])??null);}finally{s.close();}
      break;
    }
    case "releases":{
      if(argv[1]==="list"){
        const project=flag("project");if(!project)throw new Error("--project required");
        info(await request("/v1/artifacts?projectId="+encodeURIComponent(project)));
      }else if(argv[1]==="publish"&&argv[2]){
        const s=store();try{info({releaseId:new Registry(s,root).publish(argv[2])});}finally{s.close();}
      }else if(argv[1]==="rollback"&&argv[2]){
        const s=store();try{info({activeReleaseId:new Registry(s,root).rollback(argv[2])});}finally{s.close();}
      }else throw new Error("Expected releases list|publish|rollback");
      break;
    }
    default:info(`adaptive-harness commands:
  daemon start|stop
  ui [--no-open]
  project register --root PATH
  install|uninstall --provider opencode --scope project|user [--root PATH] [--apply]
  doctor --provider opencode --launcher cli|t3 [--json]
  status [--json]
  memory search --project ID QUERY
  candidates list --project ID
  candidates propose --project ID --kind skill|rule --key KEY --file PATH --evidence ID1,ID2
  candidates evaluate PROPOSAL_ID (inconclusive without isolated replay runner)
  evaluations show ID
  releases list --project ID
  releases publish PROPOSAL_ID
  releases rollback RELEASE_ID`);
  }
}
void main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
