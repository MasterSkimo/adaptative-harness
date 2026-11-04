import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ContractError } from "../../../packages/contracts/src/index.ts";
import { history, overview, recordKinds, type RecordKind } from "../../../packages/core/src/dashboard.ts";
import type { Store } from "../../../packages/storage/src/store.ts";

/**
 * Read-only browser UI with short-lived one-time pairing.
 * Persistent Harness credentials never enter browser storage or JavaScript.
 */
const uiRoot=join(dirname(fileURLToPath(import.meta.url)),"../../ui/public");
const securityHeaders={
  "cache-control":"no-store",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY",
  "referrer-policy":"no-referrer",
  "permissions-policy":"camera=(), microphone=(), geolocation=()",
  "content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function respond(res:http.ServerResponse,status:number,data:unknown){
  res.writeHead(status,{...securityHeaders,"content-type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data));
}
function asset(res:http.ServerResponse,file:string,type:string){
  res.writeHead(200,{...securityHeaders,"content-type":type});
  res.end(readFileSync(join(uiRoot,file)));
}
function deny(res:http.ServerResponse){
  respond(res,401,{code:"UNAUTHORIZED",message:"Run adaptive-harness ui to authorize this browser"});
}
export class DashboardUi {
  private readonly tickets=new Map<string,number>();
  private readonly sessions=new Map<string,number>();
  readonly store:Store;
  constructor(store:Store){this.store=store;}
  /**
   * The daemon only hands out a pairing link after validating the CLI bearer.
   * Pairing codes expire in 60 s and can be redeemed once.
   */
  createPairing(port:number):{url:string;expiresInSeconds:number}{
    const code=randomBytes(32).toString("hex");
    this.tickets.set(code,Date.now()+60_000);
    if(this.tickets.size>32){
      for(const [key,expiry] of this.tickets){if(expiry<Date.now())this.tickets.delete(key);}
      if(this.tickets.size>32)this.tickets.delete(this.tickets.keys().next().value!);
    }
    return {url:"http://127.0.0.1:"+port+"/ui/activate?code="+code,expiresInSeconds:60};
  }
  private allowed(req:http.IncomingMessage){
    const match=/(?:^|;\s*)ah_ui=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||"");
    if(!match)return false;
    const expiry=this.sessions.get(match[1]);
    if(!expiry || expiry<=Date.now()){
      this.sessions.delete(match[1]);
      return false;
    }
    return true;
  }
  /**
   * All UI routes are read-only. Session cookie has Path=/ui and cannot be
   * used as an alternative bearer credential on /v1 endpoints.
   */
  handle(req:http.IncomingMessage,res:http.ServerResponse,url:URL):boolean {
    if(!url.pathname.startsWith("/ui"))return false;
    if(req.method!=="GET" || req.headers.origin || !["none","same-origin",undefined].includes(req.headers["sec-fetch-site"] as string|undefined)){
      respond(res,403,{code:"FORBIDDEN",message:"Same-origin navigation required"});
      return true;
    }
    if(url.pathname==="/ui/activate"){
      const code=url.searchParams.get("code")||"";
      const expiry=this.tickets.get(code);
      this.tickets.delete(code);
      if(!expiry || expiry<=Date.now()){
        deny(res);return true;
      }
      const sid=randomBytes(32).toString("hex");
      this.sessions.set(sid,Date.now()+2*60*60*1000);
      res.writeHead(303,{...securityHeaders,"location":"/ui",
        "set-cookie":"ah_ui="+sid+"; HttpOnly; SameSite=Strict; Path=/ui; Max-Age=7200"});
      res.end();
      return true;
    }
    if(!this.allowed(req)){deny(res);return true;}
    if(url.pathname==="/ui" || url.pathname==="/ui/"){
      asset(res,"index.html","text/html; charset=utf-8");return true;
    }
    if(url.pathname==="/ui/app.js"){
      asset(res,"app.js","text/javascript; charset=utf-8");return true;
    }
    if(url.pathname==="/ui/style.css"){
      asset(res,"style.css","text/css; charset=utf-8");return true;
    }
    if(url.pathname==="/ui/api/overview"){
      const projectId=url.searchParams.get("projectId")||undefined;
      respond(res,200,overview(this.store,projectId));return true;
    }
    if(url.pathname==="/ui/api/history"){
      const kind=url.searchParams.get("kind") as RecordKind;
      if(!recordKinds.includes(kind))throw new ContractError("Unknown record kind");
      const projectId=url.searchParams.get("projectId")||undefined;
      const rawBefore=url.searchParams.get("before");
      const rawLimit=url.searchParams.get("limit");
      const before=rawBefore===null?undefined:Number(rawBefore);
      const limit=rawLimit===null?50:Number(rawLimit);
      respond(res,200,history(this.store,{kind,projectId,before,limit}));
      return true;
    }
    respond(res,404,{code:"NOT_FOUND",message:"Unknown UI resource"});
    return true;
  }
  close(){this.tickets.clear();this.sessions.clear();}
}
