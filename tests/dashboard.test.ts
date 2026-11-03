import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Daemon } from "../apps/daemon/src/server.ts";
import { token } from "../packages/core/src/config.ts";
import { history, overview } from "../packages/core/src/dashboard.ts";
import { ContractError } from "../packages/contracts/src/index.ts";

const at=()=>new Date().toISOString();
function fake(projectId:string,kind="tool.completed"){
  return {
    schemaVersion:1 as const,eventId:randomUUID(),sourceInstanceId:"source_opencode_test",
    provider:"opencode" as const,nativeSessionId:"session-fixture",projectId,eventType:kind,
    occurredAt:at(),observedAt:at(),privacyClass:"metadata" as const,
    outcome:"failed" as const,metadata:{toolName:"bash",errorCode:"exit-1"}
  };
}
test("dashboard projections are paged, project isolated and exclude stored paths",()=>{
  const root=mkdtempSync(join(tmpdir(),"ah-ui-projection-"));
  const daemon=new Daemon(root);
  try{
    const db=daemon.store;
    const a=db.registerProject(join(root,"alpha"),"alpha");
    const b=db.registerProject(join(root,"beta"),"beta");
    db.bindSource("source_opencode_test",a);
    db.bindSource("source_opencode_test",b);
    const received=[fake(a),fake(b),fake(a),fake(a)];
    for(const e of received)db.ingest(e);
    const page1=history(db,{kind:"events",projectId:a,limit:2});
    assert.equal(page1.items.length,2);
    assert.equal(page1.hasMore,true);
    assert.equal(page1.items.every(e=>e.projectId===a),true);
    const page2=history(db,{kind:"events",projectId:a,limit:2,before:page1.nextCursor!});
    assert.equal(page2.items.length,1);
    assert.equal(page2.hasMore,false);
    assert.ok(page1.items[0].metadata.toolName);
    assert.equal("payload" in page1.items[0],false);
    assert.equal("prompt" in page1.items[0],false);
    assert.equal(overview(db,a).metrics.events,3);
    assert.equal(overview(db,b).metrics.events,1);
    assert.equal(overview(db).metrics.events,4);
    assert.ok(overview(db,a).projects.every(p=>!("local_root_path" in p)));
    assert.throws(()=>history(db,{kind:"events",projectId:"unknown-id"}),e=>e instanceof ContractError&&e.status===403);
    assert.throws(()=>history(db,{kind:"events",limit:101}),ContractError);
    assert.throws(()=>history(db,{kind:"events",before:-1}),ContractError);
    const jobs=history(db,{kind:"jobs",projectId:a,limit:10});
    assert.equal(jobs.items.length,3);
    assert.ok(jobs.items.every(j=>!("payload_json" in j)));
  }finally{daemon.store.close();rmSync(root,{recursive:true,force:true});}
});
test("browser UI requires a one-time pairing; cookies cannot access core APIs",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ah-ui-http-"));
  const daemon=new Daemon(root);
  let started=false;
  try{
    const db=daemon.store;
    const project=db.registerProject(join(root,"fixture"),"synthetic");
    db.bindSource("source_opencode_test",project);
    db.ingest(fake(project));
    const port=await daemon.start();started=true;
    const base="http://127.0.0.1:"+port;
    const auth={authorization:"Bearer "+token(root)};
    assert.equal((await fetch(base+"/ui")).status,401);
    assert.equal((await fetch(base+"/ui/app.js")).status,401);
    assert.equal((await fetch(base+"/ui/api/overview")).status,401);
    assert.equal((await fetch(base+"/v1/ui/pair",{method:"POST"})).status,401);
    const pair=await fetch(base+"/v1/ui/pair",{method:"POST",headers:auth});
    assert.equal(pair.status,200);
    const ticket=await pair.json() as {url:string;expiresInSeconds:number};
    assert.equal(ticket.expiresInSeconds,60);
    // CLI uses the private token only to request another single-use browser ticket.
    const cli=fileURLToPath(new URL("../apps/cli/src/main.ts",import.meta.url));
    const child=spawn(process.execPath,["--experimental-strip-types",cli,"ui","--no-open"],{
      env:{...process.env,ADAPTIVE_HARNESS_HOME:root},stdio:["ignore","pipe","pipe"]
    });
    let stdout="",stderr="";
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    child.stdout.on("data",(chunk:string)=>{stdout+=chunk;});
    child.stderr.on("data",(chunk:string)=>{stderr+=chunk;});
    const exit=await new Promise<number|null>((resolve,reject)=>{
      child.once("error",reject);
      child.once("exit",resolve);
    });
    assert.equal(exit,0,stderr);
    const cliTicket=JSON.parse(stdout) as {url:string};
    assert.match(cliTicket.url,/^http:\/\/127\.0\.0\.1:\d+\/ui\/activate\?code=[0-9a-f]{64}$/);

    assert.match(ticket.url,/^http:\/\/127\.0\.0\.1:\d+\/ui\/activate\?code=[0-9a-f]{64}$/);
    const activated=await fetch(ticket.url,{redirect:"manual"});
    assert.equal(activated.status,303);
    assert.equal(activated.headers.get("location"),"/ui");
    const cookie=activated.headers.get("set-cookie")||"";
    assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\/ui/);
    assert.equal((await fetch(ticket.url,{redirect:"manual"})).status,401);
    const credentials={cookie:cookie.split(";")[0]};
    const doc=await fetch(base+"/ui",{headers:credentials});
    assert.equal(doc.status,200);
    assert.match(doc.headers.get("content-security-policy")||"",/default-src 'none'/);
    assert.match(doc.headers.get("referrer-policy")||"",/no-referrer/);
    assert.match(await doc.text(),/Adaptive Harness/);
    const script=await fetch(base+"/ui/app.js",{headers:credentials});
    assert.equal(script.status,200);
    assert.match(script.headers.get("content-type")||"",/text\/javascript/);
    assert.doesNotMatch(await script.text(),/\.innerHTML\s*=/);
    assert.equal((await fetch(base+"/ui/style.css",{headers:credentials})).status,200);
    assert.equal((await fetch(base+"/v1/status",{headers:credentials})).status,401);
    assert.equal((await fetch(base+"/ui/api/overview",{headers:{...credentials,origin:"https://hostile.example"}})).status,403);
    assert.equal((await fetch(base+"/ui/api/overview",{method:"POST",headers:credentials})).status,403);
    const overviewResponse=await fetch(base+"/ui/api/overview?projectId="+project,{headers:credentials});
    assert.equal(overviewResponse.status,200);
    const view=await overviewResponse.json() as {metrics:{events:number};projects:Array<{name:string}>};
    assert.equal(view.metrics.events,1);
    assert.equal(view.projects[0].name,"synthetic");
    const listing=await fetch(base+"/ui/api/history?kind=events&limit=1&projectId="+project,{headers:credentials});
    assert.equal(listing.status,200);
    const results=await listing.json() as {items:Array<{metadata:Record<string,string>}>};
    assert.equal(results.items.length,1);
    assert.equal(results.items[0].metadata.toolName,"bash");
    assert.equal((await fetch(base+"/ui/api/history?kind=wrong",{headers:credentials})).status,400);
    assert.equal((await fetch(base+"/ui/api/overview?projectId=foreign",{headers:credentials})).status,403);
    assert.equal((await fetch(base+"/ui/api/history?kind=events&limit=1000",{headers:credentials})).status,400);
  }finally{
    if(started)await daemon.stop();else daemon.store.close();
    rmSync(root,{recursive:true,force:true});
  }
});
