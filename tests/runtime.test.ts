import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/storage/src/store.ts";
import { Worker } from "../packages/core/src/worker.ts";
import { parseContext, parseEvent, ContractError } from "../packages/contracts/src/index.ts";
import { Daemon } from "../apps/daemon/src/server.ts";
import { token } from "../packages/core/src/config.ts";

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
test("failure then verified repair creates one cited project lesson and is scoped",()=>{
  const f=fixture();
  try{
    const failed=event(f.a),success=event(f.a,{outcome:"succeeded",metadata:{toolName:"bash",inputDigest:digest}});
    f.store.ingest(failed);f.store.ingest(success);
    const worker=new Worker(f.store);
    assert.equal(worker.drain(),2);
    assert.equal(f.store.stats().memories,1);
    assert.equal(worker.drain(),0);
    const request={schemaVersion:1 as const,provider:"opencode" as const,sourceInstanceId:"source_opencode_test",
      projectId:f.a,nativeSessionId:"new-session",query:"Observed recovery",maxItems:5,maxTokens:600};
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
