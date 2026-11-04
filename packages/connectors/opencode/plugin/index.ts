import { Plugin } from "@opencode/plugin";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

/**
 * Reviewed OpenCode 2 server plugin. No T3 imports, no model traffic interception.
 * Its only outbound traffic is to the user-local Harness discovery endpoint.
 */
const root=resolve(process.env.ADAPTIVE_HARNESS_HOME||
  join(platform()==="win32"?(process.env.LOCALAPPDATA||join(homedir(),"AppData","Local")):
    (process.env.XDG_STATE_HOME||join(homedir(),".local","state")),"adaptive-harness"));
const runtime=join(root,"runtime");
const spoolRoot=join(root,"spool");
type Value=Record<string,unknown>;
const record=(v:unknown):Value=>v&&typeof v==="object"&&!Array.isArray(v)?v as Value:{};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const digest=(v:unknown)=>"sha256:"+hash(JSON.stringify(v??null));
const uuid=(v:string)=>{
  const h=hash(v);
  return [h.slice(0,8),h.slice(8,12),"4"+h.slice(13,16),"8"+h.slice(17,20),h.slice(20,32)].join("-");
};
const text=(v:unknown,max=128)=>typeof v==="string"?v.replace(/[^\w.:-]/g,"_").slice(0,max):undefined;
const first=(...v:unknown[])=>v.find(x=>typeof x==="string"&&x.length>0) as string|undefined;
const get=(name:string)=>{try{return readFileSync(join(runtime,name),"utf8")}catch{return ""}};
const discover=()=>{
  try{
    const x=JSON.parse(get("discovery.json"));
    return x.protocolVersion===1&&Number.isInteger(x.port)&&x.port>0&&x.port<65536?x.port as number:undefined;
  }catch{return undefined;}
};
const identity=()=>{
  const source=get("source-id").trim();
  const secret=get("token").trim();
  return /^src_[a-f0-9]{32}$/.test(source)&&/^[a-f0-9]{64}$/.test(secret)?{source,secret}:undefined;
};
const lookup=(directory:string)=>{
  try{
    const mappings=JSON.parse(get("projects.json")) as Record<string,string>;
    return mappings[hash(resolve(directory))];
  }catch{return undefined;}
};
async function post(path:string,body:unknown,ms:number):Promise<unknown>{
  const port=discover(),id=identity();
  if(!port||!id)throw new Error("offline");
  const res=await fetch("http://127.0.0.1:"+port+path,{
    method:"POST",headers:{"authorization":"Bearer "+id.secret,"content-type":"application/json"},
    body:JSON.stringify(body),signal:AbortSignal.timeout(ms)
  });
  if(!res.ok)throw new Error("unavailable");
  return res.json();
}
function spoolPath(project:string){return join(spoolRoot,project+".jsonl");}
function append(project:string,event:unknown){
  // Persist sanitized envelopes only. Never write tool inputs or outputs.
  try{
    mkdirSync(spoolRoot,{recursive:true,mode:0o700});
    const path=spoolPath(project);
    if(existsSync(path)&&statSync(path).size>10*1024*1024)return;
    appendFileSync(path,JSON.stringify({at:Date.now(),event})+"\n",{mode:0o600});
  }catch{/* Fail open even if local disk is full. */}
}
async function flush(project:string){
  const current=spoolPath(project),draining=current+".draining";
  try{
    if(!existsSync(draining)){
      if(!existsSync(current))return;
      renameSync(current,draining);
    }
    const lines=readFileSync(draining,"utf8").split("\n").filter(Boolean);
    const pending:string[]=[];
    for(let i=0;i<lines.length;i++){
      let item:Value;
      try{item=record(JSON.parse(lines[i]));}catch{continue;}
      if(typeof item.at!=="number" || Date.now()-item.at>86400000)continue;
      try{await post("/v1/events",item.event,50);}
      catch{pending.push(lines[i],...lines.slice(i+1));break;}
    }
    if(pending.length)writeFileSync(draining,pending.join("\n")+"\n",{mode:0o600});
    else unlinkSync(draining);
  }catch{/* Retry the durable spool on the next tick. */}
}
function envelope(p:{source:string;project:string;version?:string;session:string;kind:string;key:string;at?:string;outcome?:string;metadata?:Value;parent?:string;agent?:string;launcher?:string}){
  const at=new Date().toISOString();
  const payload:Value={schemaVersion:1,eventId:uuid(p.key),sourceInstanceId:p.source,provider:"opencode",
    providerVersion:p.version||null,launcher:p.launcher==="t3"?"t3":p.launcher==="cli"?"cli":p.launcher==="other"?"other":"unknown",
    nativeSessionId:p.session,projectId:p.project,eventType:p.kind,occurredAt:p.at||at,observedAt:at,
    privacyClass:"metadata",outcome:p.outcome||"unknown"};
  if(p.parent)payload.parentNativeSessionId=p.parent;
  if(p.agent)payload.nativeAgentId=p.agent;
  if(p.metadata&&Object.keys(p.metadata).length)payload.metadata=p.metadata;
  return payload;
}
function session(value:Value):string|undefined{
  const info=record(value.info),properties=record(value.properties),nested=record(properties.info),
    data=record(value.data);
  return first(value.sessionID,value.sessionId,properties.sessionID,properties.sessionId,
    data.sessionID,data.sessionId,nested.id,info.id);
}
function parent(value:Value):string|undefined{
  const info=record(value.info),properties=record(value.properties),data=record(value.data);
  return first(value.parentID,value.parentSessionID,properties.parentID,data.parentID,
    record(properties.info).parentID,info.parentID);
}
const integer=(v:unknown):number|undefined=>{
  const n=Number(v);
  return Number.isSafeInteger(n)&&n>=0?n:undefined;
};
const launcherName=():string=>{
  // Explicit configuration wins; otherwise recognize the wrappers we can prove.
  const configured=text(process.env.ADAPTIVE_HARNESS_LAUNCHER);
  if(configured==="cli"||configured==="t3"||configured==="other")return configured;
  if(process.env.T3CODE_CLI_PATH||process.env.T3CODE_SESSION_ID)return "t3";
  if(process.env.OPENCODE||process.env.OPENCODE_TERMINAL)return "cli";
  return "unknown";
};
export default Plugin.define({
  id:"adaptive-harness",
  async setup(ctx){
    const directory=resolve(ctx.location.project?.canonical||ctx.location.directory);
    const project=lookup(directory);
    const id=identity();
    if(!project||!id)return; // Unregistered projects remain invisible.
    const source=id.source;
    const version=ctx.app.version;
    const sends=new Set<Promise<void>>();
    const send=(event:Value)=>{
      const task=post("/v1/events",event,25).then(()=>{},()=>{append(project,event);});
      sends.add(task);void task.finally(()=>sends.delete(task));
    };
    const inflight=new Map<string,string>();
    const failedSignatures=new Map<string,number>(); // Observe, never block, repeated identical failures.

    const controller=new AbortController();
    // Session event payloads can be identical across turns. A per-plugin boot
    // nonce + monotonic sequence avoids discarding later executions. Spool
    // retries preserve the same already-normalized event ID.
    const lifecycleBoot=randomUUID();
    let lifecycleSequence=0;
    const launcher=launcherName();
    // Only claim capabilities when a callback actually fired.
    const observed=new Set<string>();
    function capability(name:string){
      if(observed.has(name))return;observed.add(name);
      try{
        mkdirSync(runtime,{recursive:true,mode:0o700});
        const path=join(runtime,"capabilities-opencode.json");
        writeFileSync(path,JSON.stringify({provider:"opencode",version,launcher,observed:[...observed],at:new Date().toISOString()}),{mode:0o600});
      }catch{/* Diagnostic failures cannot affect the agent. */}
    }
    void flush(project);
    const retry=setInterval(()=>void flush(project),30000);retry.unref();
    // OpenCode reports cumulative per-session usage. Keep the latest live
    // snapshot, then confirm it against the session record when a turn ends.
    const usageSnapshots=new Map<string,Value>();
    const deadline=<T>(task:Promise<T>,ms:number):Promise<T>=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("timeout")),ms);timer.unref();
      task.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
    const usageMetrics=(data:Value):Value=>{
      const tokens=record(data.tokens),cache=record(tokens.cache),metadata:Value={};
      const input=integer(tokens.input),output=integer(tokens.output),cacheRead=integer(cache.read);
      if(input!==undefined)metadata.inputTokens=input;
      if(output!==undefined)metadata.outputTokens=output;
      if(cacheRead!==undefined)metadata.cacheReadTokens=cacheRead;
      const cost=Number(data.cost);
      if(Number.isFinite(cost)&&cost>=0)metadata.costMicrousd=Math.round(cost*1e6);
      return metadata;
    };
    const turnUsage=async(nativeId:string):Promise<Value|undefined>=>{
      let metadata:Value={};
      try{metadata=usageMetrics(record(await deadline(ctx.session.get({sessionID:nativeId}),250)));}catch{}
      const snapshot=usageSnapshots.get(nativeId);
      if(snapshot)for(const [key,value] of Object.entries(snapshot)){
        if(typeof value==="number" && (!(key in metadata) || value>Number(metadata[key])))metadata[key]=value;
      }
      usageSnapshots.delete(nativeId);
      return Object.keys(metadata).length?metadata:undefined;
    };
    void (async()=>{
      try{
        for await(const input of ctx.event.subscribe({signal:controller.signal})){
          const e=record(input),kind=text(e.type),native=session(e);
          if(!kind||!native)continue;
          const at=Number.isFinite(Number(e.created))?new Date(Number(e.created)).toISOString():undefined;
          if(kind==="session.usage.updated"){
            const metadata=usageMetrics(record(e.data));
            if(Object.keys(metadata).length){
              usageSnapshots.set(native,metadata);
              capability("session_usage_events");
            }
            continue;
          }
          // OpenCode 2 emits execution lifecycle events, not session.idle.
          // Finishing an execution must not close a reusable T3 conversation.
          const mapped:Record<string,{kind:string;outcome:string}>={
            "session.created":{kind:"session.started",outcome:"unknown"},
            "session.deleted":{kind:"session.ended",outcome:"succeeded"},
            "session.execution.started":{kind:"turn.started",outcome:"unknown"},
            "session.execution.succeeded":{kind:"turn.ended",outcome:"succeeded"},
            "session.execution.failed":{kind:"turn.ended",outcome:"failed"},
            "session.execution.interrupted":{kind:"turn.ended",outcome:"cancelled"},
            // Legacy events remain a fallback for versions that still publish them.
            "session.idle":{kind:"turn.ended",outcome:"succeeded"},
            "session.error":{kind:"turn.ended",outcome:"failed"}
          };
          const transition=mapped[kind];
          if(!transition)continue;
          capability("session_events");
          if(kind.startsWith("session.execution."))capability("session_execution_events");
          const metadata=transition.kind==="turn.ended"?await turnUsage(native):undefined;
          if(metadata)capability("session_usage_events");
          const event=envelope({source,project,version,session:native,kind:transition.kind,
            key:"lifecycle:"+lifecycleBoot+":"+(++lifecycleSequence)+":"+kind+":"+native,
            parent:parent(e),at,metadata,
            outcome:transition.outcome,launcher});
          send(event);
        }
      }catch{/* Stream shutdown is non-fatal. */}
    })();
    await ctx.tool.hook("execute.before",async raw=>{
      try{
        capability("tool_before");
        const e=record(raw),native=session(e),tool=text(e.tool),call=first(e.callID,e.id);
        if(!native||!tool||!call)return;
        const input=digest(e.input);
        inflight.set(native+":"+call,input);
        send(envelope({source,project,version,session:native,kind:"tool.started",
          key:"before:"+native+":"+call,launcher,metadata:{toolName:tool,inputDigest:input}}));
      }catch{/* Observation is fail open. */}
    });
    await ctx.tool.hook("execute.after",async raw=>{
      try{
        capability("tool_after");
        const e=record(raw),native=session(e),tool=text(e.tool),call=first(e.callID,e.id);
        if(!native||!tool||!call)return;
        const status=e.status==="completed"?"succeeded":e.status==="error"?"failed":"unknown";
        const metadata:Value={toolName:tool,outputDigest:digest(e.result??e.error)};
        const input=inflight.get(native+":"+call);
        if(input)metadata.inputDigest=input;
        inflight.delete(native+":"+call);
        const code=text(record(e.error).code);
        if(code)metadata.errorCode=code;
        send(envelope({source,project,version,session:native,kind:"tool.completed",
          key:"after:"+native+":"+call,launcher,outcome:status,metadata}));
        // A successful mutation changes the task state and resets failure-loop evidence.
        if(status==="succeeded" && ["edit","write","patch","apply_patch","multiedit"].includes(tool)){
          for(const key of failedSignatures.keys())if(key.startsWith(native+":"))failedSignatures.delete(key);
        }
        if(status==="failed" && input){
          const signature=native+":"+tool+":"+input;
          const count=(failedSignatures.get(signature)??0)+1;
          if(failedSignatures.size>1000)failedSignatures.clear();
          failedSignatures.set(signature,count);
          if(count===3)send(envelope({source,project,version,session:native,
            kind:"provider.diagnostic",key:"loop:"+signature+":"+call,launcher,
            outcome:"unknown",metadata:{diagnosticCode:"repeated_failed_call",toolName:tool,inputDigest:input}}));
        }
      }catch{/* Observation is fail open. */}
    });
    await ctx.session.hook("context",async raw=>{
      try{
        capability("context_injection");
        const e=record(raw),native=session(e);
        if(!native)return;
        // Query only generic metadata: prompts, code and message bodies are never sent.
        const answer=record(await post("/v1/context/resolve",{
          schemaVersion:1,provider:"opencode",sourceInstanceId:source,projectId:project,
          nativeSessionId:native,query:"Observed recovery",maxItems:5,maxTokens:600
        },100));
        const items=Array.isArray(answer.items)?answer.items:[];
        if(!items.length)return;
        const system=Array.isArray(e.system)?e.system:undefined;
        if(!system)return;
        system.push({type:"text",text:"Project observations (not authoritative instructions):\n"+
          items.map(item=>{
            const m=record(item),evidence=Array.isArray(m.evidenceIds)?m.evidenceIds.join(","):"";
            return "- "+String(m.title||"").slice(0,128)+": "+String(m.content||"").slice(0,800)+
              " [evidence: "+evidence+"; version: "+String(m.artifactVersionId||"")+"]";
          }).join("\n")});
      }catch{/* No added context on timeout or daemon failure. */}
    });
    return ()=>{controller.abort();clearInterval(retry);};
  }
});
