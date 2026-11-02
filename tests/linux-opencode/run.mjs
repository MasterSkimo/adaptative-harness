import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

// The local model fixture generates tool requests; OpenCode itself executes the
// real read tool. No external model credentials or model traffic are used.
const root = await mkdtemp(join(tmpdir(), "adaptive-linux-"));
const project = join(root, "project"), home = join(root, "home"), state = join(home, ".adaptive-harness");
const main = join(process.cwd(), "dist/apps/daemon/src/main.js");
const env = { ...process.env, HOME: home, PWD: project, FIXTURE_API_KEY: "synthetic" };
delete env.LOCALAPPDATA;
let daemon, model, calls = 0, toolCalls = 0, interruptBetweenTools = false;
async function run(file, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    const timer = setTimeout(() => { child.kill(); reject(new Error("command timed out")); }, 30000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
  });
}
async function startDaemon() {
  daemon = spawn(process.execPath, [main, "start"], {cwd:project, env, stdio:"ignore"});
  for (let i=0; i<100; i++) { if (daemon.exitCode !== null) throw new Error("daemon exited on startup"); try { const d = JSON.parse(await readFile(join(state,"daemon.json"),"utf8")); if ((await fetch(`http://127.0.0.1:${d.port}/health`)).ok) return; } catch {} await delay(100); }
  throw new Error("daemon did not start");
}
async function stopDaemon() {
  const result = await run(process.execPath, [main,"stop"]); assert.equal(result.code, 0, "daemon stop");
  for(let i=0; i<100 && daemon.exitCode === null; i++) await delay(50);
  assert.notEqual(daemon.exitCode, null, "daemon did not stop");
}
function events() { const db = new DatabaseSync(join(state,"harness.sqlite"),{readOnly:true}); try { return db.prepare("SELECT event_type, outcome, sanitized_payload_json FROM events ORDER BY sequence").all(); } finally { db.close(); } }
async function session() {
  calls=0; toolCalls=0;
  const result = await run("opencode", ["run","--standalone","--auto","--model","fixture/fixture","Read the test files."]);
  assert.equal(result.code, 0, "OpenCode task failed: " + result.stderr.slice(-5000));
  assert.equal(toolCalls, 3, "OpenCode did not complete both tool turns");
  assert.match(result.stderr, /Read absent\.txt failed/);
  assert.match(result.stderr, /Read fixture\.txt/);
  await delay(300);
}
try {
  await mkdir(join(project,".opencode/plugins/adaptative-harness"),{recursive:true});
  assert.match(process.version, /^v24\./); const version = await run("opencode", ["--version"]); assert.equal(version.stdout.trim(), "opencode v2.2.5"); console.log(`Runtime Node ${process.version}; ${version.stdout.trim()}`);
  await mkdir(home,{recursive:true});
  await copyFile(join(process.cwd(),"packages/connectors/opencode-v2/plugin.ts"),join(project,".opencode/plugins/adaptative-harness/index.ts"));
  await writeFile(join(project,"fixture.txt"),"LINUX_FIXTURE_OK\n");
  await writeFile(join(project,".opencode/adaptative-harness.json"),JSON.stringify({sourceInstanceId:"source_linux",projectId:"project_linux",discoveryFile:join(state,"daemon.json"),tokenFile:join(state,"token")}));
  await writeFile(join(project,"opencode.json"),JSON.stringify({providers:{fixture:{name:"Fixture",package:"@opencode/ai/providers/openai-compatible",env:["FIXTURE_API_KEY"],settings:{baseURL:"http://127.0.0.1:38881/v1"},models:{fixture:{name:"Fixture"}}}}}));
  model=createServer((req,res)=>{let input="";req.on("data",chunk=>input+=chunk);req.on("end",async()=>{
    calls++; const body=JSON.parse(input); const hasTools=Array.isArray(body.tools)&&body.tools.length>0; if(hasTools) toolCalls++; if (interruptBetweenTools && toolCalls === 2) { await delay(300); await stopDaemon(); interruptBetweenTools = false; }
    res.writeHead(200,{"content-type":"text/event-stream"});
    const chunk=(delta,finish_reason=null)=>res.write("data: "+JSON.stringify({id:"test",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta,finish_reason}]})+"\n\n");
    if(hasTools && toolCalls<=2){const path=join(project,toolCalls===1?"absent.txt":"fixture.txt");chunk({role:"assistant",tool_calls:[{index:0,id:`call_${toolCalls}`,type:"function",function:{name:"read",arguments:JSON.stringify({path})}}]});chunk({},"tool_calls");}
    else {chunk({role:"assistant",content:"Finished."});chunk({},"stop");} res.end("data: [DONE]\n\n");
  });});
  await new Promise(resolve=>model.listen(38881,"127.0.0.1",resolve));
  assert.equal((await run(process.execPath,[main,"register","source_linux","project_linux"])).code,0);
  await startDaemon(); await session();
  let rows=events(); assert.equal(rows.length,4); assert.deepEqual(rows.map(r=>r.event_type).sort(),["tool.completed","tool.completed","tool.started","tool.started"]);
  assert.deepEqual(rows.filter(r=>r.event_type==="tool.completed").map(r=>r.outcome).sort(),["failed","unknown"]);
  assert.equal(new Set(rows.map(r=>JSON.parse(r.sanitized_payload_json).spanId)).size,2);
  assert.doesNotMatch(JSON.stringify(rows), /LINUX_FIXTURE_OK|absent\.txt|fixture\.txt/);
  { const db = new DatabaseSync(join(state,"harness.sqlite"),{readOnly:true}); try { assert.equal(db.prepare("SELECT count(*) AS n FROM processing_jobs").get().n, 4); } finally { db.close(); } }
  console.log("PASS Linux OpenCode 2.2.5: native plugin, two correlated read tool calls and event ingestion (4 events)");
  await stopDaemon(); await session(); assert.equal(events().length,4);
  console.log("PASS daemon unavailable: OpenCode executed both read tools; events dropped as currently documented");
  await startDaemon(); assert.equal(events().length,4); await session(); rows=events(); assert.equal(rows.length,8);
  console.log("PASS daemon restart: prior events survived and 4 new events were ingested");
  interruptBetweenTools = true; await session(); rows=events(); assert.equal(rows.length,10);
  console.log("PASS daemon interruption between tool calls: task completed; first call persisted and second call dropped");
} finally { if (daemon && daemon.exitCode===null) daemon.kill(); if(model) model.close(); }
