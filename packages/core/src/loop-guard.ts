/**
 * Observation-only deterministic loop detector. No orchestration, no native
 * blocking unless a future connector proves the provider's capability.
 */
export interface LoopSignal {sessionId:string;tool:string;inputDigest:string;attempts:number;}
export class LoopGuard {
  private readonly attempts=new Map<string,{count:number;at:number}>();
  private readonly epoch=new Map<string,number>();
  readonly threshold:number;
  readonly ttlMs:number;
  constructor(threshold=3,ttlMs=600000){this.threshold=threshold;this.ttlMs=ttlMs;}
  edited(sessionId:string){
    this.epoch.set(sessionId,(this.epoch.get(sessionId)??0)+1);
    for(const key of this.attempts.keys())if(key.startsWith(sessionId+"|"))this.attempts.delete(key);
  }
  completed(sessionId:string,tool:string,inputDigest:string,outcome:string):LoopSignal|undefined {
    if(this.attempts.size>1000)this.attempts.clear();
    const key=[sessionId,tool,inputDigest,this.epoch.get(sessionId)??0].join("|");
    if(outcome!=="failed"){this.attempts.delete(key);return undefined;}
    const previous=this.attempts.get(key);
    const n=previous && Date.now()-previous.at<this.ttlMs?previous.count+1:1;
    this.attempts.set(key,{count:n,at:Date.now()});
    return n===this.threshold?{sessionId,tool,inputDigest,attempts:n}:undefined;
  }
}
