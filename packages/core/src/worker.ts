import { randomUUID } from "node:crypto";
import { Store } from "../../storage/src/store.ts";

/** Crash-safe at-least-once worker with idempotent learning effects. */
export class Worker {
  readonly owner=randomUUID();
  constructor(readonly store:Store){}
  step():boolean {
    const job=this.store.claim(this.owner);
    if(!job)return false;
    try{
      if(job.job_type==="classify" && job.event_sequence!=null)this.store.learn(Number(job.event_sequence));
      else throw new Error("unsupported_job_type");
      this.store.complete(job,this.owner);
    }catch(err){
      // Do not store exception text: it may contain private data.
      this.store.fail(job,this.owner,"classification_failed");
    }
    return true;
  }
  drain(limit=100){let count=0;while(count<limit && this.step())count++;return count;}
}
