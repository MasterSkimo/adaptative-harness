import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { Store } from "../../../packages/storage/src/store.ts";
import { Worker } from "../../../packages/core/src/worker.ts";
import { atomicPrivate, loadSettings, prepare, token } from "../../../packages/core/src/config.ts";
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
  readonly store:Store; readonly worker:Worker; readonly settings;
  private readonly secret:string;
  private readonly server:http.Server;
  private ticker:NodeJS.Timeout|undefined;
  constructor(readonly root:string){
    prepare(root);this.secret=token(root);this.settings=loadSettings(root);
    this.store=new Store(join(root,"data","harness.sqlite"));
    this.worker=new Worker(this.store);
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
      if(!authenticated(req.headers.authorization,this.secret))return json(res,401,{code:"UNAUTHORIZED",message:"Bearer token required"});
      const url=new URL(req.url||"/","http://127.0.0.1");
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
    await new Promise<void>((ok,fail)=>{
      this.server.once("error",fail);
      this.server.listen(this.settings.transport.port,"127.0.0.1",()=>{this.server.off("error",fail);ok();});
    });
    const address=this.server.address();
    if(!address || typeof address==="string")throw new Error("Unexpected listener");
    atomicPrivate(join(this.root,"runtime","discovery.json"),JSON.stringify({protocolVersion:1,port:address.port,pid:process.pid}));
    this.ticker=setInterval(()=>{this.worker.drain(100);},250);
    this.ticker.unref();
    return address.port;
  }
  async stop(){
    if(this.ticker)clearInterval(this.ticker);
    await new Promise<void>((resolve,reject)=>this.server.close(e=>e?reject(e):resolve()));
    const path=join(this.root,"runtime","discovery.json");
    if(existsSync(path))unlinkSync(path);
    this.store.close();
  }
}
