import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Store } from "../packages/storage/src/store.ts";
import { history, overview } from "../packages/core/src/dashboard.ts";
import { Worker } from "../packages/core/src/worker.ts";
import { parseContext, parseEvent, ContractError } from "../packages/contracts/src/index.ts";
import { Daemon } from "../apps/daemon/src/server.ts";
import { assertPrivateRoot, loadSettings, prepare, readDiscovery, token } from "../packages/core/src/config.ts";

const t=()=>new Date().toISOString();
const digest="sha256:"+"a".repeat(64);
const fixture=()=> {
  const dir=mkdtempSync(join(tmpdir(),"harness-test-"));
  const store=new Store(join(dir,"data","test.sqlite"));
  const a=store.registerProject(join(dir,"project-a"),"a");
  const b=store.registerProject(join(dir,"project-b"),"b");
  store.bindSource("source_opencode_test",a);
  store.bindSource("source_opencode_test",b);
  const end=()=>{store.close();rmSync(dir,{recursive:true,force:true});};
  return {dir,store,a,b,end};
};
function event(projectId:string,opts:Record<string,unknown>={}){
  return parseEvent({schemaVersion:1,eventId:randomUUID(),sourceInstanceId:"source_opencode_test",provider:"opencode",
    nativeSessionId:"native-session",projectId,eventType:"tool.completed",
    occurredAt:t(),observedAt:t(),privacyClass:"metadata",outcome:"failed",
    metadata:{toolName:"bash",inputDigest:digest,errorCode:"exit-1"},...opts});
}
test("contract rejects transcript body, unsupported schema and unsanitized metadata",()=>{
  const f=fixture();
  try{
    const input=event(f.a);
    assert.equal(parseEvent(input).schemaVersion,1);
    assert.throws(()=>parseEvent({...input,prompt:"secret"}),ContractError);
    assert.throws(()=>parseEvent({...input,schemaVersion:2}),ContractError);
    assert.throws(()=>parseEvent({...input,metadata:{toolName:"bash",command:"cat .env"}}),ContractError);
    assert.throws(()=>parseContext({schemaVersion:1,provider:"opencode",sourceInstanceId:"source_opencode_test",
      projectId:f.a,nativeSessionId:"sess",query:"hello",maxItems:21,maxTokens:600}),ContractError);
  }finally{f.end();}
});
test("dedupe is idempotent and payload collisions are rejected",()=>{
  const f=fixture();
  try{
    const input=event(f.a);
    const a=f.store.ingest(input),b=f.store.ingest(input);
    assert.equal(a.disposition,"accepted");assert.equal(b.disposition,"duplicate");
    assert.equal(a.sequence,b.sequence);
    assert.throws(()=>f.store.ingest({...input,outcome:"succeeded"}),e=>e instanceof ContractError&&e.status===409);
    assert.equal(f.store.stats().queued,1);
    assert.equal(f.store.stats().events,1);
  }finally{f.end();}
});
test("source and project bindings reject spoofing",()=>{
  const f=fixture();
  try{
    const input=event(f.a);
    assert.throws(()=>f.store.ingest({...input,sourceInstanceId:"unknown_source_abcd"}),e=>e instanceof ContractError&&e.status===403);
    assert.throws(()=>f.store.search({...parseContext({schemaVersion:1,provider:"opencode",
      sourceInstanceId:"unknown_source_abcd",projectId:f.a,nativeSessionId:"s",query:"recovery",maxItems:5,maxTokens:600})}),ContractError);
  }finally{f.end();}
});
test("failure then verified repair creates one cited candidate lesson and is scoped",()=>{
  const f=fixture();
  try{
    const failed=event(f.a),success=event(f.a,{outcome:"succeeded",metadata:{toolName:"bash",inputDigest:digest}});
    f.store.ingest(failed);f.store.ingest(success);
    const worker=new Worker(f.store);
    assert.equal(worker.drain(),2);
    // A single observation yields a candidate, never auto-published context.
    assert.equal(f.store.stats().memories,0);
    const candidates=f.store.listMemories(f.a,"candidate");
    assert.equal(candidates.items.length,1);
    assert.equal(candidates.items[0].confidence,0.5);
    assert.ok(new Date(String(candidates.items[0].validUntil)).getTime()>Date.now());
    const request={schemaVersion:1 as const,provider:"opencode" as const,sourceInstanceId:"source_opencode_test",
      projectId:f.a,nativeSessionId:"new-session",query:"Observed recovery",maxItems:5,maxTokens:600};
    assert.equal(f.store.search(request).items.length,0);
    f.store.publishMemory(String(candidates.items[0].memoryId));
    const result=f.store.search(request);
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].evidenceIds.length,2);
    assert.equal(f.store.search({...request,projectId:f.b}).items.length,0);
    assert.equal(f.store.search({...request,maxTokens:1}).items.length,0);
    assert.equal(f.store.list("artifacts",f.a).length,1);
    assert.equal(f.store.list("artifacts",f.b).length,0);
    // Reprocessing after a crash does not duplicate learned effects.
    const successRow=f.store.get("SELECT sequence FROM events WHERE event_id=?",success.eventId);
    assert.equal(f.store.learn(successRow!.sequence),false);
    assert.equal(f.store.stats().memories,1);
    // Archiving removes retrieved context without deleting provenance.
    f.store.archiveMemory(String(candidates.items[0].memoryId));
    assert.equal(f.store.search(request).items.length,0);
    assert.equal(f.store.stats().memories,0);
  }finally{f.end();}
});
test("unverified success and unrelated signatures never become a lesson",()=>{
  const f=fixture();
  try{
    f.store.ingest(event(f.a));
    f.store.ingest(event(f.a,{outcome:"succeeded",metadata:{toolName:"bash",inputDigest:"sha256:"+"b".repeat(64)}}));
    new Worker(f.store).drain();
    assert.equal(f.store.stats().memories,0);
  }finally{f.end();}
});
test("expired lease is recovered and processed idempotently",()=>{
  const f=fixture();
  try{
    f.store.ingest(event(f.a));
    const job=f.store.claim("crashed",1);
    assert.ok(job);
    f.store.run("UPDATE processing_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?",job!.id);
    assert.equal(new Worker(f.store).drain(),1);
    assert.equal(f.store.get("SELECT status FROM processing_jobs WHERE id=?",job!.id)?.status,"succeeded");
  }finally{f.end();}
});
test("state root refuses foreign discovery and unsafe retention settings",()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-config-"));
  try{
    prepare(dir);
    assert.ok(readDiscovery(dir)===undefined);
    writeFileSync(join(dir,"runtime","discovery.json"),JSON.stringify({
      protocolVersion:1,port:1234,pid:process.pid,rootFingerprint:"sha256:"+"b".repeat(64)
    }));
    assert.equal(readDiscovery(dir),undefined);
    writeFileSync(join(dir,"config.json"),JSON.stringify({schemaVersion:1,memory:{retentionDays:0}}));
    assert.throws(()=>loadSettings(dir),/Unsafe Harness settings/);
    writeFileSync(join(dir,"config.json"),JSON.stringify({schemaVersion:1,memory:{retentionDays:30}}));
    assert.equal(loadSettings(dir).memory.retentionDays,30);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("state root permissions are verified and fail closed",()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-acl-"));
  try{
    prepare(dir);
    assertPrivateRoot(dir);
    if(process.platform==="win32"){
      // Granting Everyone read access must be detected, not silently accepted.
      const probe=spawnSync("icacls",[dir,"/grant","*S-1-1-0:(OI)(CI)(RX)"],{encoding:"utf8",timeout:10000});
      if(probe.status===0)assert.throws(()=>assertPrivateRoot(dir),/other local users/);
    }else{
      chmodSync(dir,0o755);
      assert.throws(()=>assertPrivateRoot(dir),/too open/);
    }
  }finally{
    if(process.platform!=="win32")chmodSync(dir,0o700);
    rmSync(dir,{recursive:true,force:true});
  }
});
test("daemon enforces a single instance, drains automatically and stops over authenticated HTTP",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-lifecycle-"));
  const daemon=new Daemon(dir);
  const second=new Daemon(dir);
  try{
    const project=daemon.store.registerProject(join(dir,"project"),"project");
    daemon.store.bindSource("source_opencode_test",project);
    const port=await daemon.start();
    const base="http://127.0.0.1:"+port;
    const auth={authorization:"Bearer "+token(dir),"content-type":"application/json"};
    // A second daemon on the same root fails closed without killing the live one.
    await assert.rejects(()=>second.start(),/already running/);
    const failure=event(project);
    const success=event(project,{outcome:"succeeded",metadata:{toolName:"bash",inputDigest:digest}});
    for(const item of [failure,success]){
      assert.equal((await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify(item)})).status,202);
    }
    // No manual Worker.drain(): the daemon ticker must process queued jobs itself.
    const deadline=Date.now()+5000;
    while(Number(daemon.store.stats().queued)>0 && Date.now()<deadline)await new Promise(done=>setTimeout(done,25));
    assert.equal(daemon.store.stats().queued,0);
    assert.equal(daemon.store.listMemories(project,"candidate").items.length,1);
    assert.equal((await fetch(base+"/v1/daemon/stop",{method:"POST"})).status,401);
    const stopped=await fetch(base+"/v1/daemon/stop",{method:"POST",headers:auth});
    assert.equal(stopped.status,202);
    await daemon.waitForStop();
    assert.equal(existsSync(join(dir,"runtime","discovery.json")),false);
    assert.equal(existsSync(join(dir,"runtime","daemon.lock")),false);
    // The lock is released, so a new instance can own the root.
    const third=new Daemon(dir);
    try{assert.ok((await third.start())>0);}finally{await third.stop();}
  }finally{
    await daemon.stop();
    await second.stop();
    rmSync(dir,{recursive:true,force:true});
  }
});
test("HTTP bearer, host, 64KiB boundary, collision, context and health",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-http-"));
  const daemon=new Daemon(dir);
  try{
    const s=daemon.store,a=s.registerProject(join(dir,"a"),"a");
    s.bindSource("source_opencode_test",a);
    const port=await daemon.start();
    const base="http://127.0.0.1:"+port;
    const secret=token(dir);
    const auth={authorization:"Bearer "+secret,"content-type":"application/json"};
    const health=await fetch(base+"/health");
    assert.deepEqual(await health.json(),{status:"ok",protocolVersion:1});
    assert.equal((await fetch(base+"/v1/status")).status,401);
    assert.equal((await fetch(base+"/v1/status",{headers:{authorization:"Bearer bad"}})).status,401);
    assert.equal((await fetch(base+"/v1/status",{headers:{...auth,origin:"https://attacker.invalid"}})).status,403);
    const input=event(a);
    const accepted=await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify(input)});
    assert.equal(accepted.status,202);const receipt=await accepted.json() as {sequence:number};
    assert.ok(receipt.sequence>0);
    assert.equal((await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify(input)})).status,200);
    assert.equal((await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify({...input,outcome:"succeeded"})})).status,409);
    assert.equal((await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify({padding:"a".repeat(65536)})})).status,413);
    assert.equal((await fetch(base+"/v1/events",{method:"POST",headers:auth,body:JSON.stringify({...input,prompt:"secret"})})).status,400);
    assert.equal((await fetch(base+"/v1/context/resolve",{method:"POST",headers:auth,body:JSON.stringify({
      schemaVersion:1,provider:"opencode",sourceInstanceId:"source_opencode_test",projectId:a,nativeSessionId:"s",query:"recovery",maxItems:5,maxTokens:600
    })})).status,200);
  }finally{await daemon.stop();rmSync(dir,{recursive:true,force:true});}
});

// The OpenCode 2 execution can finish while its T3 conversation remains open.
test("session execution lifecycle is independent of conversation closure",()=>{
  const f=fixture();
  try{
    const send=(kind:string,outcome:"succeeded"|"failed"|"cancelled"|"unknown"="unknown")=>
      f.store.ingest(event(f.a,{eventType:kind,outcome}));
    const read=()=>history(f.store,{kind:"sessions",projectId:f.a}).items[0];
    send("session.started");
    // Session exists, but no execution has yet been observed.
    assert.equal(read().status,"unknown");
    assert.equal(read().executionStatus,"unknown");
    const first=event(f.a,{eventType:"turn.started",outcome:"unknown"});
    f.store.ingest(first);
    assert.equal(read().executionStatus,"running");
    assert.equal(overview(f.store,f.a).metrics.running,1);
    const finished=event(f.a,{eventType:"turn.ended",outcome:"succeeded"});
    f.store.ingest(finished);
    assert.equal(read().status,"idle");
    assert.equal(read().lifecycleStatus,"running");
    assert.equal(read().executionStatus,"succeeded");
    assert.equal(read().finishedAt,null);
    assert.ok(read().executionFinishedAt);
    assert.equal(overview(f.store,f.a).metrics.running,0);

    // A new user prompt reopens the execution, not the conversation.
    send("turn.started");
    assert.equal(read().status,"running");
    assert.equal(read().executionStatus,"running");
    assert.equal(read().executionFinishedAt,null);
    send("turn.ended","failed");
    assert.equal(read().status,"idle");
    assert.equal(read().executionStatus,"failed");
    send("turn.started");
    send("turn.ended","cancelled");
    assert.equal(read().status,"idle");
    assert.equal(read().executionStatus,"cancelled");
    assert.equal(overview(f.store,f.b).metrics.running,0);

    // Idempotent redelivery must not clobber the newer execution status.
    assert.equal(f.store.ingest(first).disposition,"duplicate");
    assert.equal(f.store.ingest(finished).disposition,"duplicate");
    assert.equal(read().executionStatus,"cancelled");
    assert.equal(f.store.get("SELECT COUNT(*) n FROM session_execution_state")?.n,1);
    send("session.ended","succeeded");
    assert.equal(read().status,"completed");
    assert.equal(read().lifecycleStatus,"completed");
    assert.ok(read().finishedAt);

    // A delayed spool replay can arrive after its newer completion.
    const session="delayed-replay-session";
    f.store.ingest(event(f.a,{nativeSessionId:session,eventType:"turn.ended",outcome:"succeeded",
      occurredAt:"2026-11-04T02:00:01.000Z"}));
    f.store.ingest(event(f.a,{nativeSessionId:session,eventType:"turn.started",outcome:"unknown",
      occurredAt:"2026-11-04T02:00:00.000Z"}));
    const replayed=history(f.store,{kind:"sessions",projectId:f.a}).items.find(x=>x.sessionId===session);
    assert.equal(replayed?.executionStatus,"succeeded");
    assert.equal(replayed?.status,"idle");
  }finally{f.end();}
});
test("provider usage snapshots replace instead of accumulate and refresh the source",()=>{
  const f=fixture();
  try{
    const session="usage-session";
    f.store.ingest(event(f.a,{nativeSessionId:session,eventType:"turn.ended",outcome:"succeeded",launcher:"t3",
      providerVersion:"2.2.5",occurredAt:"2026-11-04T02:00:00.000Z",
      metadata:{inputTokens:100,outputTokens:20,cacheReadTokens:30,costMicrousd:1234}}));
    let usage=overview(f.store,f.a).usage;
    assert.equal(usage.inputTokens,100);
    assert.equal(usage.outputTokens,20);
    assert.equal(usage.estimatedCostMicrousd,1234);
    const source=history(f.store,{kind:"sources",projectId:f.a}).items[0];
    assert.equal(source.launcher,"t3");
    assert.equal(source.runtimeVersion,"2.2.5");

    // A later snapshot carries the new cumulative totals.
    f.store.ingest(event(f.a,{nativeSessionId:session,eventType:"turn.ended",outcome:"succeeded",launcher:"t3",
      occurredAt:"2026-11-04T02:00:01.000Z",
      metadata:{inputTokens:250,outputTokens:60,cacheReadTokens:40,costMicrousd:2000}}));
    usage=overview(f.store,f.a).usage;
    assert.equal(usage.inputTokens,250);
    assert.equal(usage.outputTokens,60);

    // A delayed older snapshot must not roll the totals back.
    f.store.ingest(event(f.a,{nativeSessionId:session,eventType:"turn.ended",outcome:"succeeded",
      occurredAt:"2026-11-04T01:59:59.000Z",metadata:{inputTokens:5,outputTokens:1}}));
    usage=overview(f.store,f.a).usage;
    assert.equal(usage.inputTokens,250);
    assert.equal(usage.outputTokens,60);
    assert.equal(f.store.get("SELECT COUNT(*) n FROM session_usage")?.n,1);
  }finally{f.end();}
});
