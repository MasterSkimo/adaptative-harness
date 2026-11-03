import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { Store } from "../../../packages/storage/src/store.ts";
import { DashboardUi } from "./dashboard-ui.ts";
import { Worker } from "../../../packages/core/src/worker.ts";
import {
  acquireInstanceLock, atomicPrivate, loadSettings, prepare, releaseInstanceLock, rootFingerprint, token,
  type InstanceLock
} from "../../../packages/core/src/config.ts";
import { ContractError, parseContext, parseEvent, sanitizeEvent } from "../../../packages/contracts/src/index.ts";

const json=(res:http.ServerResponse,status:number,data:unknown)=>{
  const body=JSON.stringify(data);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(body);
};
async function body(req:http.IncomingMessage,max:number):Promise<unknown>{
  const claimed=Number(req.headers["content-length"]);
  if(Number.isFinite(claimed)&&claimed>max)throw new ContractError("Payload too large",413);
  let total=0;const chunks:Buffer[]=[];
  for await(const chunk of req){
    total+=chunk.length;
    if(total>max)throw new ContractError("Payload too large",413);
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw new ContractError("Malformed JSON");}
}
function authenticated(header:string|undefined,secret:string):boolean{
  const value=header?.startsWith("Bearer ")?header.slice(7):"";
  const a=Buffer.from(value),b=Buffer.from(secret);
  return a.length===b.length && timingSafeEqual(a,b);
}
export class Daemon {
  readonly store:Store; readonly worker:Worker; readonly settings; readonly ui:DashboardUi;
  private readonly secret:string;
  private readonly server:http.Server;
  private ticker:NodeJS.Timeout|undefined;
  private lock:InstanceLock|undefined;
  private started=false;
  private tickerBusy=false;
  private stopping:Promise<void>|undefined;
  private readonly stopped:Promise<void>;
  private resolveStopped:()=>void=()=>{};
  readonly root:string;
  constructor(root:string){
    this.root=root;
    prepare(root);this.secret=token(root);this.settings=loadSettings(root);
    this.stopped=new Promise<void>(resolve=>{this.resolveStopped=resolve;});
    this.store=new Store(join(root,"data","harness.sqlite"),{retentionDays:this.settings.memory.retentionDays});
    this.worker=new Worker(this.store);
    this.ui=new DashboardUi(this.store);
    this.server=http.createServer((req,res)=>void this.handle(req,res));
    this.server.requestTimeout=3000;this.server.headersTimeout=3000;
    this.server.maxConnections=128;
  }
  private async handle(req:http.IncomingMessage,res:http.ServerResponse):Promise<void>{
    try{
      // Reject browser-originated calls and Host confusion; no CORS headers.
      if(req.headers.origin || !/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||"")){
        return json(res,403,{code:"FORBIDDEN",message:"Local client required"});
      }
      if(req.method==="GET" && req.url==="/health")return json(res,200,{status:"ok",protocolVersion:1});
      const url=new URL(req.url||"/","http://127.0.0.1");
      // Browser sessions grant access only to the read-only /ui namespace.
      if(this.ui.handle(req,res,url))return;
      if(!authenticated(req.headers.authorization,this.secret))return json(res,401,{code:"UNAUTHORIZED",message:"Bearer token required"});
      if(req.method==="POST" && url.pathname==="/v1/daemon/stop"){
        // Authenticated shutdown: never signal an arbitrary PID recorded on disk.
        // Answer only once the acknowledgement is flushed, then stop.
        res.once("finish",()=>setImmediate(()=>void this.stop()));
        return json(res,202,{status:"stopping"});
      }
      if(req.method==="POST" && url.pathname==="/v1/ui/pair"){
        const address=this.server.address();
        if(!address || typeof address==="string")throw new ContractError("Daemon not listening",503);
        return json(res,200,this.ui.createPairing(address.port));
      }
      if(req.method==="POST" && url.pathname==="/v1/events"){
        if(!this.settings.collection.enabled)return json(res,403,{code:"DISABLED",message:"Collection disabled"});
        if(Number(this.store.stats().queued)>10000)return json(res,429,{code:"BACKPRESSURE",message:"Queue full"});
        const input=await body(req,this.settings.collection.maxEventBytes);
        const event=sanitizeEvent(parseEvent(input));
        if(event.privacyClass!=="metadata")throw new ContractError("Sensitive excerpts disabled",403);
        const result=this.store.ingest(event);
        return json(res,result.disposition==="accepted"?202:200,result);
      }
      if(req.method==="POST" && url.pathname==="/v1/context/resolve"){
        const input=parseContext(await body(req,16384));
        const request={...input,maxItems:Math.min(input.maxItems,this.settings.memory.maxItems),maxTokens:Math.min(input.maxTokens,this.settings.memory.maxTokens)};
        return json(res,200,this.store.search(request));
      }
      if(req.method==="GET" && url.pathname==="/v1/artifacts"){
        const id=url.searchParams.get("projectId")||"";
        const limit=Math.max(1,Math.min(100,Number(url.searchParams.get("limit")||20)));
        return json(res,200,{items:this.store.list("artifacts",id,limit)});
      }
      if(req.method==="GET" && url.pathname==="/v1/evaluations"){
        return json(res,200,{items:this.store.list("evaluations",url.searchParams.get("projectId")||"")});
      }
      if(req.method==="GET" && url.pathname==="/v1/status")return json(res,200,this.store.stats());
      json(res,404,{code:"NOT_FOUND",message:"Unknown endpoint"});
    }catch(err){
      const status=err instanceof ContractError?err.status:500;
      json(res,status,{code:status===500?"INTERNAL":"INVALID_REQUEST",message:status===500?"Request failed":(err as Error).message});
    }
  }
  async start():Promise<number>{
    if(this.started)throw new Error("Daemon already started");
    if(this.stopping)throw new Error("Daemon is shutting down");
    // One live instance per state root; a stale lock from a dead process is replaced.
    const lockPath=join(this.root,"runtime","daemon.lock");
    const lock=acquireInstanceLock(lockPath);
    try{
      await new Promise<void>((ok,fail)=>{
        this.server.once("error",fail);
        this.server.listen(this.settings.transport.port,"127.0.0.1",()=>{this.server.off("error",fail);ok();});
      });
    }catch(error){
      releaseInstanceLock(lockPath,lock.instanceId);
      throw error;
    }
    const address=this.server.address();
    if(!address || typeof address==="string"){
      releaseInstanceLock(lockPath,lock.instanceId);
      throw new Error("Unexpected listener");
    }
    this.lock=lock;this.started=true;
    atomicPrivate(join(this.root,"runtime","discovery.json"),JSON.stringify({
      protocolVersion:1,port:address.port,pid:process.pid,
      instanceId:lock.instanceId,rootFingerprint:rootFingerprint(this.root)
    }));
    this.tick();
    this.ticker=setInterval(()=>this.tick(),250);
    this.ticker.unref();
    return address.port;
  }
  /** A single ticker loop: slow storage work must not overlap or kill the daemon. */
  private tick(){
    if(this.tickerBusy || this.stopping)return;
    this.tickerBusy=true;
    try{this.worker.drain(100);}
    catch{/* transient SQLite contention is retried on the next tick */}
    finally{this.tickerBusy=false;}
  }
  /** Idempotent shutdown, safe to call from a signal, the stop endpoint or a test. */
  stop():Promise<void>{
    if(!this.stopping)this.stopping=this.shutdown();
    return this.stopping;
  }
  waitForStop():Promise<void>{return this.stopped;}
  private async shutdown():Promise<void>{
    if(this.ticker){clearInterval(this.ticker);this.ticker=undefined;}
    this.ui.close();
    if(this.started){
      this.started=false;
      this.server.closeIdleConnections();
      await new Promise<void>(resolve=>{
        const force=setTimeout(()=>{this.server.closeAllConnections();resolve();},2000);
        force.unref();
        this.server.close(()=>{clearTimeout(force);resolve();});
      });
      const path=join(this.root,"runtime","discovery.json");
      try{
        if(existsSync(path)){
          const discovery=JSON.parse(readFileSync(path,"utf8")) as {pid?:number;instanceId?:string};
          // Only remove the discovery record this process published.
          if(discovery.pid===process.pid || discovery.instanceId===this.lock?.instanceId)unlinkSync(path);
        }
      }catch{}
    }
    if(this.lock){
      releaseInstanceLock(join(this.root,"runtime","daemon.lock"),this.lock.instanceId);
      this.lock=undefined;
    }
    try{this.store.close();}catch{}
    this.resolveStopped();
  }
}
