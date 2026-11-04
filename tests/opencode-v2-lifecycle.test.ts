import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { Daemon } from "../apps/daemon/src/server.ts";
import { atomicPrivate, sourceId } from "../packages/core/src/config.ts";
import { history, overview } from "../packages/core/src/dashboard.ts";

/**
 * Feed a realistic OpenCode 2 callback stream through the actual plugin's
 * setup function. Stub only the SDK wrapper; use the real local HTTP daemon.
 * This is a contract fixture, not a live T3 / provider acceptance test.
 */
test("OpenCode 2 completion callbacks normalize without closing the T3 session",async()=>{
  const root=mkdtempSync(join(tmpdir(),"harness-opencode2-"));
  const projectRoot=join(root,"test-project");
  mkdirSync(projectRoot,{recursive:true});
  const previousHome=process.env.ADAPTIVE_HARNESS_HOME;
  const previousLauncher=process.env.ADAPTIVE_HARNESS_LAUNCHER;
  process.env.ADAPTIVE_HARNESS_HOME=root;
  process.env.ADAPTIVE_HARNESS_LAUNCHER="t3";
  const daemon=new Daemon(root);
  let started=false;
  let cleanup:undefined|(()=>void);
  try{
    const projectId=daemon.store.registerProject(projectRoot,"fixture");
    const source=sourceId(root);
    daemon.store.bindSource(source,projectId);
    const projectHash=createHash("sha256").update(resolve(projectRoot)).digest("hex");
    atomicPrivate(join(root,"runtime","projects.json"),JSON.stringify({[projectHash]:projectId}));
    await daemon.start();started=true;

    // Strip types and substitute just Plugin.define to invoke the real adapter
    // without requiring an OpenCode account or provider SDK in CI.
    const pluginPath=fileURLToPath(new URL("../packages/connectors/opencode/plugin/index.ts",import.meta.url));
    const pluginTs=readFileSync(pluginPath,"utf8").replace(
      'import { Plugin } from "@opencode/plugin";',
      'const Plugin = { define: (definition) => definition };'
    );
    const executable=stripTypeScriptTypes(pluginTs,{mode:"strip"});
    const mod=await import("data:text/javascript;base64,"+Buffer.from(executable).toString("base64"));

    const events=[
      {type:"session.created"},
      {type:"session.execution.started"},
      {type:"session.usage.updated",data:{
        cost:0.001234,
        tokens:{input:100,output:20,reasoning:5,cache:{read:30,write:2}}
      }},
      {type:"session.execution.succeeded"},
      {type:"session.execution.started"},
      {type:"session.execution.failed"},
      {type:"session.execution.started"},
      {type:"session.execution.interrupted"},
      {type:"session.deleted"}
    ];
    const nativeId="t3-session-fixture";
    const callback=async function*(){
      let created=Date.now();
      for(const event of events){
        // Real V2 bus callbacks carry the session ID under `data`.
        yield {type:event.type,created:created++,data:{sessionID:nativeId,...(event as {data?:object}).data}};
        await new Promise(resolve=>setTimeout(resolve,30));
      }
    };
    const hooks=new Map<string,unknown>();
    let reads=0;
    const ctx={
      location:{project:{canonical:projectRoot},directory:projectRoot},
      app:{version:"2.2.x"},
      event:{subscribe:(_input:unknown)=>callback()},
      tool:{hook:async(name:string,handler:unknown)=>{hooks.set(name,handler);}},
      session:{
        hook:async(name:string,handler:unknown)=>{hooks.set(name,handler);},
        get:async()=>{
          reads+=1;
          return {cost:0.001*reads,tokens:{input:90+reads*10,output:18+reads*2,reasoning:4,cache:{read:25,write:2}}};
        }
      }
    };
    cleanup=await mod.default.setup(ctx);
    // The connector has a 25ms fail-open timeout. Replaying bounded spool
    // fixtures exercises eventual delivery without waiting for the 30s timer.
    await new Promise(resolve=>setTimeout(resolve,700));
    const auth={authorization:"Bearer "+readFileSync(join(root,"runtime","token"),"utf8"),"content-type":"application/json"};
    for(const path of [join(root,"spool",projectId+".jsonl"),join(root,"spool",projectId+".jsonl.draining")]){
      if(!existsSync(path))continue;
      for(const line of readFileSync(path,"utf8").split("\n").filter(Boolean)){
        const item=JSON.parse(line) as {event:unknown};
        const response=await fetch("http://127.0.0.1:"+JSON.parse(readFileSync(join(root,"runtime","discovery.json"),"utf8")).port+"/v1/events",{
          method:"POST",headers:auth,body:JSON.stringify(item.event)
        });
        assert.ok([200,202].includes(response.status),"Spool item must be accepted or deduplicated");
      }
    }
    const limit=Date.now()+3000;
    const expected=8; // usage.updated annotates the following turn.ended, it is not an event of its own.
    while(daemon.store.stats().events<expected && Date.now()<limit){
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(daemon.store.stats().events,expected);
    const rows=history(daemon.store,{kind:"events",projectId,limit:20}).items
      .sort((a,b)=>String(a.occurredAt).localeCompare(String(b.occurredAt)));
    assert.deepEqual(rows.map(x=>x.type),[
      "session.started","turn.started","turn.ended","turn.started",
      "turn.ended","turn.started","turn.ended","session.ended"
    ]);
    assert.deepEqual(rows.map(x=>x.outcome),[
      "unknown","unknown","succeeded","unknown",
      "failed","unknown","cancelled","succeeded"
    ]);
    // The first turn reports the cumulative usage observed during that turn.
    // The live snapshot (cache 30, cost 1234) is newer than the session record.
    assert.deepEqual(rows[2].metadata,{inputTokens:100,outputTokens:20,cacheReadTokens:30,costMicrousd:1234});
    assert.ok(hooks.has("execute.before"));
    assert.ok(hooks.has("execute.after"));
    assert.ok(hooks.has("context"));
    const session=history(daemon.store,{kind:"sessions",projectId}).items[0];
    assert.equal(session.lifecycleStatus,"completed");
    assert.equal(session.executionStatus,"cancelled");
    assert.equal(session.status,"completed");
    assert.ok(session.finishedAt);
    const usage=overview(daemon.store,projectId).usage;
    assert.equal(usage.inputTokens,120);
    assert.equal(usage.outputTokens,24);
    assert.equal(usage.estimatedCostMicrousd,3000);
    const instance=history(daemon.store,{kind:"sources",projectId}).items[0];
    assert.equal(instance.launcher,"t3");
    assert.equal(instance.runtimeVersion,"2.2.x");
  }finally{
    cleanup?.();
    if(started)await daemon.stop();else daemon.store.close();
    if(previousHome===undefined)delete process.env.ADAPTIVE_HARNESS_HOME;
    else process.env.ADAPTIVE_HARNESS_HOME=previousHome;
    if(previousLauncher===undefined)delete process.env.ADAPTIVE_HARNESS_LAUNCHER;
    else process.env.ADAPTIVE_HARNESS_LAUNCHER=previousLauncher;
    rmSync(root,{recursive:true,force:true});
  }
});
