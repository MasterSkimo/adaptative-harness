import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readDiscovery, stateRoot } from "./config.ts";

/** CLI HTTP client; never puts its local bearer token in argv or logs. */
export async function request(path:string,method="GET",data?:unknown,root=stateRoot(),deadlineMs=1000):Promise<any> {
  const discovery=readDiscovery(root);
  if(!discovery)throw new Error("Harness daemon not running");
  const secret=readFileSync(join(root,"runtime","token"),"utf8").trim();
  const result=await fetch("http://127.0.0.1:"+discovery.port+path,{
    method,headers:{"authorization":"Bearer "+secret,"content-type":"application/json"},
    body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(deadlineMs)
  });
  const text=await result.text();
  const value=JSON.parse(text);
  if(!result.ok)throw new Error("Harness returned "+result.status+": "+(value.code??"error"));
  return value;
}
