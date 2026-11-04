import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { Daemon } from "../apps/daemon/src/server.ts";
import { atomicPrivate, sourceId } from "../packages/core/src/config.ts";
import { history } from "../packages/core/src/dashboard.ts";

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
  process.env.ADAPTIVE_HARNESS_HOME=root;
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
      "session.created",
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.started",
      "session.execution.failed",
      "session.execution.started",
      "session.execution.interrupted",
      "session.deleted"
    ];
    const nativeId="t3-session-fixture";
    const callback=async function*(){
      for(const type of events){
        // Real V2 callbacks carry sessionID under properties.
        yield {type,properties:{sessionID:nativeId}};
        await new Promise(resolve=>setTimeout(resolve,30));
      }
    };
    const hooks=new Map<string,unknown>();
    const ctx={
      location:{project:{canonical:projectRoot},directory:projectRoot},
      app:{version:"2.2.x"},
      event:{subscribe:(_input:unknown)=>callback()},
      tool:{hook:async(name:string,handler:unknown)=>{hooks.set(name,handler);}},
      session:{hook:async(name:string,handler:unknown)=>{hooks.set(name,handler);}}
    };
    cleanup=await mod.default.setup(ctx);
    const limit=Date.now()+5000;
    while(daemon.store.stats().events<events.length && Date.now()<limit){
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(daemon.store.stats().events,events.length);
    const rows=history(daemon.store,{kind:"events",projectId,limit:20}).items.reverse();
    assert.deepEqual(rows.map(x=>x.type),[
      "session.started","turn.started","turn.ended","turn.started",
      "turn.ended","turn.started","turn.ended","session.ended"
    ]);
    assert.deepEqual(rows.map(x=>x.outcome),[
      "unknown","unknown","succeeded","unknown",
      "failed","unknown","cancelled","succeeded"
    ]);
    assert.ok(hooks.has("execute.before"));
    assert.ok(hooks.has("execute.after"));
    assert.ok(hooks.has("context"));
    const session=history(daemon.store,{kind:"sessions",projectId}).items[0];
    assert.equal(session.lifecycleStatus,"completed");
    assert.equal(session.executionStatus,"cancelled");
    assert.equal(session.status,"completed");
    assert.ok(session.finishedAt);
  }finally{
    cleanup?.();
    if(started)await daemon.stop();else daemon.store.close();
    if(previousHome===undefined)delete process.env.ADAPTIVE_HARNESS_HOME;
    else process.env.ADAPTIVE_HARNESS_HOME=previousHome;
    rmSync(root,{recursive:true,force:true});
  }
});
