#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Self-contained process-level acceptance smoke.
 * Synthetic metadata only; never invokes a model or changes user provider config.
 */
const repo=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const cli=join(repo,"apps","cli","src","main.ts");
const workspace=mkdtempSync(join(tmpdir(),"adaptive-harness-smoke-"));
const home=join(workspace,"home");
const project=join(workspace,"project");
mkdirSync(project,{recursive:true});
const env={...process.env,ADAPTIVE_HARNESS_HOME:home};
const results=[];
const stamp=()=>new Date().toISOString();
const check=(name,ok,details={})=>{
  results.push({id:name,status:ok?"passed":"failed",at:stamp(),...details});
  if(!ok)throw new Error(name+" failed");
};
function call(...args){
  const r=spawnSync(process.execPath,["--experimental-strip-types",cli,...args],{encoding:"utf8",timeout:10000,env});
  assert.equal(r.status,0,r.stderr);
  return JSON.parse(r.stdout);
}
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=async(test,max=8000)=>{
  const end=Date.now()+max;
  while(Date.now()<end){
    const value=await test();
    if(value)return value;
    await wait(100);
  }
  throw new Error("Timeout waiting for fixture state");
};
let daemon;
let status="failed",errorCode=null;
try{
  const registered=call("project","register","--root",project);
  check("SMOKE-001",Boolean(registered.projectId));
  const projectId=registered.projectId;
  const source=readFileSync(join(home,"runtime","source-id"),"utf8").trim();

  daemon=spawn(process.execPath,["--experimental-strip-types",cli,"daemon","start"],{
    cwd:repo,env,stdio:"ignore"
  });
  const disc=await deadline(()=>{
    try{
      const d=JSON.parse(readFileSync(join(home,"runtime","discovery.json"),"utf8"));
      return d.port?d:null;
    }catch{return null;}
  });
  const secret=readFileSync(join(home,"runtime","token"),"utf8").trim();
  const base="http://127.0.0.1:"+disc.port;
  const auth={authorization:"Bearer "+secret,"content-type":"application/json"};
  const health=await fetch(base+"/health");
  check("SMOKE-002",health.status===200);
  const denied=await fetch(base+"/v1/status");
  check("SMOKE-003",denied.status===401);
  const ts=stamp(),digest="sha256:"+createHash("sha256").update("synthetic-failure").digest("hex");
  const make=(id,outcome)=>({
    schemaVersion:1,eventId:id,sourceInstanceId:source,provider:"opencode",
    nativeSessionId:"smoke-native-session",projectId,eventType:"tool.completed",
    occurredAt:ts,observedAt:ts,privacyClass:"metadata",outcome,
    metadata:{toolName:"synthetic-test",inputDigest:digest,errorCode:outcome==="failed"?"exit-1":undefined}
  });
  const failure=make(randomUUID(),"failed");
  const success=make(randomUUID(),"succeeded");
  const send=(event)=>fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify(event)});
  check("SMOKE-004",(await send(failure)).status===202);
  check("SMOKE-005",(await send(failure)).status===200);
  check("SMOKE-006",(await send({...failure,outcome:"succeeded"})).status===409);
  check("SMOKE-007",(await send(success)).status===202);
  await deadline(async()=>{
    const s=await fetch(base+"/v1/status",{headers:auth});
    return (await s.json()).memories===1;
  });
  check("SMOKE-008",true,{evidence:"observed failed-success signature yielded one published project memory"});
  const resolved=await fetch(base+"/v1/context/resolve",{
    method:"POST",headers:auth,body:JSON.stringify({schemaVersion:1,provider:"opencode",sourceInstanceId:source,
      projectId,nativeSessionId:"second-session",query:"Observed recovery",maxItems:5,maxTokens:600})
  });
  const context=await resolved.json();
  check("SMOKE-009",resolved.status===200&&context.items.length===1&&context.items[0].evidenceIds.length===2);
  const p=await fetch(base+"/v1/ui/pair",{method:"POST",headers:auth});
  const pairing=await p.json();
  const activated=await fetch(pairing.url,{redirect:"manual"});
  const cookie=activated.headers.get("set-cookie")?.split(";")[0]||"";
  check("SMOKE-010",p.status===200&&activated.status===303&&cookie.startsWith("ah_ui="));
  check("SMOKE-011",(await fetch(pairing.url,{redirect:"manual"})).status===401);
  const gui=await fetch(base+"/ui",{headers:{cookie}});
  const page=await gui.text();
  check("SMOKE-012",gui.status===200&&page.includes("Adaptive Harness")&&
    (gui.headers.get("content-security-policy")||"").includes("default-src 'none'"));
  const view=await fetch(base+"/ui/api/overview?projectId="+projectId,{headers:{cookie}});
  const summary=await view.json();
  check("SMOKE-013",view.status===200&&summary.metrics.events===2&&summary.metrics.memories===1);
  const rows=await fetch(base+"/ui/api/history?kind=events&projectId="+projectId,{headers:{cookie}});
  const entries=await rows.json();
  check("SMOKE-014",rows.status===200&&entries.items.length===2&&entries.items.every(e=>e.projectId===projectId));
  check("SMOKE-015",(await fetch(base+"/v1/status",{headers:{cookie}})).status===401);
  status="passed";
}catch(error){
  errorCode=error instanceof Error?error.message.slice(0,200):"unknown";
  results.push({id:"SMOKE-ERROR",status:"failed",at:stamp(),errorCode});
}finally{
  if(daemon){
    daemon.kill("SIGTERM");
    await Promise.race([new Promise(resolve=>daemon.once("exit",resolve)),wait(1200)]);
    if(daemon.exitCode===null)daemon.kill("SIGKILL");
  }
  rmSync(workspace,{recursive:true,force:true});
}
const report={
  schemaVersion:1,kind:"local-process-smoke",status,at:stamp(),
  environment:{platform:process.platform,arch:process.arch,node:process.version,commit:process.env.GITHUB_SHA||"unknown"},
  fixtureDigest:"sha256:"+createHash("sha256").update("synthetic-failure").digest("hex"),
  results
};
const output=process.argv[2];
if(output){
  mkdirSync(dirname(resolve(output)),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+"\n",{mode:0o600});
}
console.log(JSON.stringify({status,passed:results.filter(x=>x.status==="passed").length,
  failed:results.filter(x=>x.status==="failed").length,report:output||"stdout"},null,2));
if(status!=="passed")process.exitCode=1;
