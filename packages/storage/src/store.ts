import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import type { CanonicalEvent, ContextRequest } from "../../contracts/src/index.ts";
import { ContractError } from "../../contracts/src/index.ts";

/** All writes share one SQLite connection; every externally-visible mutation is atomic. */
type Row = Record<string, any>;
const now = () => new Date().toISOString();
export const sha = (s:string) => "sha256:"+createHash("sha256").update(s).digest("hex");
export function stable(value:unknown):string {
  // Canonicalize property order so equivalent redelivery has the same digest.
  if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
  if(value && typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable((value as Row)[k])).join(",")+"}";
  return JSON.stringify(value);
}
const schemaDir = join(dirname(fileURLToPath(import.meta.url)),"../../../migrations");
export class Store {
  readonly db: DatabaseSync;
  readonly path:string;
  constructor(path:string){
    this.path=path;
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    this.db.exec(readFileSync(join(schemaDir,"0001_init.sql"),"utf8"));
    this.db.exec(readFileSync(join(schemaDir,"0002_source_bindings.sql"),"utf8"));
  }
  close(){this.db.close();}
  txn<T>(fn:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE");
    try {const value=fn();this.db.exec("COMMIT");return value;}
    catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  get(sql:string,...args:any[]):Row|undefined{return this.db.prepare(sql).get(...args) as Row|undefined;}
  all(sql:string,...args:any[]):Row[]{return this.db.prepare(sql).all(...args) as Row[];}
  run(sql:string,...args:any[]){return this.db.prepare(sql).run(...args);}
  registerProject(root:string,displayName:string):string {
    const fingerprint=sha(root);
    return this.txn(()=>{
      const existing=this.get("SELECT project_id FROM project_roots WHERE root_fingerprint=?",fingerprint);
      if(existing)return existing.project_id as string;
      const id="prj_"+randomUUID().replace(/-/g,"");
      const t=now();
      this.run("INSERT INTO projects(id,display_name,created_at,updated_at) VALUES(?,?,?,?)",id,displayName,t,t);
      this.run("INSERT INTO project_roots(id,project_id,root_fingerprint,local_root_path,verified_at) VALUES(?,?,?,?,?)",randomUUID(),id,fingerprint,root,t);
      return id;
    });
  }
  findProject(root:string):Row|undefined {
    return this.get("SELECT p.* FROM projects p JOIN project_roots r ON r.project_id=p.id WHERE r.root_fingerprint=?",sha(root));
  }
  bindSource(source:string,project:string,provider:"opencode"|"codex"="opencode",launcher:"cli"|"t3"|"other"|"unknown"="unknown",version:string|null=null){
    if(!/^[A-Za-z0-9_-]{8,128}$/.test(source))throw new ContractError("Invalid source");
    this.txn(()=>{
      const t=now();
      if(!this.get("SELECT id FROM projects WHERE id=?",project))throw new ContractError("Unknown project",403);
      const old=this.get("SELECT provider FROM provider_instances WHERE id=?",source);
      if(old && old.provider!==provider)throw new ContractError("Source/provider mismatch",403);
      this.run("INSERT OR IGNORE INTO provider_instances(id,provider,runtime_version,launcher,profile_fingerprint,capabilities_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)",source,provider,version,launcher,sha(source),t,t);
      this.run("INSERT OR IGNORE INTO source_project_bindings(source_instance_id,project_id,created_at) VALUES(?,?,?)",source,project,t);
    });
  }
  authorized(source:string,project:string,provider:string):boolean {
    return !!this.get(`SELECT 1 FROM source_project_bindings b JOIN projects p ON p.id=b.project_id
      JOIN provider_instances i ON i.id=b.source_instance_id
      WHERE b.source_instance_id=? AND b.project_id=? AND i.provider=? AND p.collection_enabled=1`,source,project,provider);
  }
  assertAuthorized(source:string,project:string,provider:string){
    if(!this.authorized(source,project,provider))throw new ContractError("Source/project not authorized",403);
  }
  ingest(event:CanonicalEvent):{eventId:string;disposition:"accepted"|"duplicate";sequence:number} {
    this.assertAuthorized(event.sourceInstanceId,event.projectId,event.provider);
    const payload=stable(event);
    const fingerprint=sha(payload);
    return this.txn(()=>{
      const existing=this.get("SELECT sequence,payload_digest FROM events WHERE source_instance_id=? AND event_id=?",event.sourceInstanceId,event.eventId);
      if(existing){
        if(existing.payload_digest!==fingerprint)throw new ContractError("Producer event ID collision",409);
        return {eventId:event.eventId,disposition:"duplicate" as const,sequence:existing.sequence as number};
      }
      const t=now();
      const nativeId=event.nativeSessionId;
      const sessionId=sha(event.sourceInstanceId+":"+nativeId);
      let parent:string|null=null;
      if(event.parentNativeSessionId){
        const p=this.get("SELECT id FROM sessions WHERE provider_instance_id=? AND native_session_id=? AND project_id=?",event.sourceInstanceId,event.parentNativeSessionId,event.projectId);
        parent=p?.id??null;
      }
      this.run(`INSERT OR IGNORE INTO sessions(id,provider_instance_id,project_id,native_session_id,parent_session_id,status,started_at)
        VALUES(?,?,?,?,?,'running',?)`,sessionId,event.sourceInstanceId,event.projectId,nativeId,parent,event.occurredAt);
      if(parent) this.run("UPDATE sessions SET parent_session_id=COALESCE(parent_session_id,?) WHERE id=?",parent,sessionId);
      const out=this.run(`INSERT INTO events(source_instance_id,event_id,project_id,session_id,native_session_id,event_type,schema_version,occurred_at,observed_at,received_at,outcome,privacy_class,payload_digest,sanitized_payload_json)
        VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,event.sourceInstanceId,event.eventId,event.projectId,sessionId,nativeId,event.eventType,event.occurredAt,event.observedAt,t,event.outcome??null,event.privacyClass,fingerprint,payload);
      const seq=Number(out.lastInsertRowid);
      const status=event.outcome==="failed"?"failed":event.outcome==="cancelled"?"cancelled":"completed";
      if(event.eventType==="session.ended"){
        this.run("UPDATE sessions SET status=?,finished_at=? WHERE id=? AND status='running'",status,event.occurredAt,sessionId);
      }
      this.run(`INSERT INTO processing_jobs(id,idempotency_key,event_sequence,project_id,job_type,available_at,created_at,updated_at)
        VALUES(?,?,?,?,'classify',?,?,?)`,randomUUID(),"classify:"+event.sourceInstanceId+":"+event.eventId,seq,event.projectId,t,t,t);
      return {eventId:event.eventId,disposition:"accepted" as const,sequence:seq};
    });
  }
  claim(owner:string,leaseMs=30000):Row|undefined {
    return this.txn(()=>{
      const t=now();
      const job=this.get(`SELECT * FROM processing_jobs WHERE
        (status='queued' AND available_at<=?) OR (status='leased' AND lease_until<?)
        ORDER BY available_at,created_at LIMIT 1`,t,t);
      if(!job)return undefined;
      this.run(`UPDATE processing_jobs SET status='leased',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=?
        WHERE id=? AND ((status='queued' AND available_at<=?) OR (status='leased' AND lease_until<?))`,owner,new Date(Date.now()+leaseMs).toISOString(),t,job.id,t,t);
      return this.get("SELECT * FROM processing_jobs WHERE id=?",job.id);
    });
  }
  complete(job:Row,owner:string){this.run("UPDATE processing_jobs SET status='succeeded',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?",now(),job.id,owner);}
  fail(job:Row,owner:string,error:string){
    const attempts=Number(job.attempts);
    this.run(`UPDATE processing_jobs SET status=?,available_at=?,last_error_code=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?`,
      attempts>=Number(job.max_attempts)?"dead":"queued",new Date(Date.now()+Math.min(60000,1000*2**attempts)).toISOString(),error.slice(0,128),now(),job.id,owner);
  }
  event(sequence:number):CanonicalEvent|undefined {
    const row=this.get("SELECT sanitized_payload_json FROM events WHERE sequence=?",sequence);
    return row?JSON.parse(row.sanitized_payload_json) as CanonicalEvent:undefined;
  }
  addEvidence(event:CanonicalEvent,sequence:number):Row|undefined{
    const kind=event.eventType==="message.corrected"?"correction":
      event.eventType==="provider.diagnostic"?"diagnostic":
      event.eventType==="tool.completed"&&event.outcome==="failed"?"failure":
      event.eventType==="tool.completed"&&event.outcome==="succeeded"?"success":null;
    if(!kind)return undefined;
    const id=sha(event.sourceInstanceId+":"+event.eventId);
    const t=now();
    this.run(`INSERT OR IGNORE INTO evidence(id,project_id,event_sequence,evidence_kind,content_digest,observed_at,created_at)
      VALUES(?,?,?,?,?,?,?)`,id,event.projectId,sequence,kind,sha(stable(event.metadata??{})),event.observedAt,t);
    return this.get("SELECT * FROM evidence WHERE id=?",id);
  }
  /** Only an observed failure followed by success with a matching signature produces a published lesson. */
  learn(sequence:number):boolean {
    return this.txn(()=>{
      const event=this.event(sequence);
      if(!event)return false;
      const evidence=this.addEvidence(event,sequence);
      if(!evidence || evidence.evidence_kind!=="success" || !event.metadata?.toolName)return false;
      const prior=this.all(`SELECT e.sequence,e.sanitized_payload_json,v.id evidence_id FROM events e
        JOIN evidence v ON v.event_sequence=e.sequence
        WHERE e.project_id=? AND e.source_instance_id=? AND e.native_session_id=? AND e.sequence<?
        AND e.event_type='tool.completed' AND e.outcome='failed' ORDER BY e.sequence DESC LIMIT 100`,
        event.projectId,event.sourceInstanceId,event.nativeSessionId,sequence);
      const failure=prior.find(row=>{
        const old=JSON.parse(row.sanitized_payload_json) as CanonicalEvent;
        return old.metadata?.toolName===event.metadata?.toolName &&
          !!(old.metadata?.correlationDigest&&old.metadata.correlationDigest===event.metadata?.correlationDigest ||
             old.metadata?.inputDigest&&old.metadata.inputDigest===event.metadata?.inputDigest);
      });
      if(!failure)return false;
      const before=JSON.parse(failure.sanitized_payload_json) as CanonicalEvent;
      const key=sha(event.projectId+":"+failure.evidence_id+":"+evidence.id);
      if(this.get("SELECT id FROM memories WHERE id=?",key))return false;
      const title="Observed recovery: "+event.metadata.toolName;
      const description="Observed failure ("+(before.metadata?.errorCode??"unknown error")+") followed by a successful "+event.metadata.toolName+
        " invocation with a matching signature. This is observation evidence, not a verified remediation procedure.";
      const t=now();const artifactId=sha("artifact:"+key);const versionId=sha("version:"+key);
      this.run("INSERT INTO artifacts(id,kind,logical_key,scope,project_id,created_at) VALUES(?,'memory',?,'project',?,?)",artifactId,key,event.projectId,t);
      this.run("INSERT INTO artifact_versions(id,artifact_id,version_number,content_digest,storage_path,status,created_at) VALUES(?,?,1,?,?,'published',?)",
        versionId,artifactId,sha(description),"memory:"+key,t);
      const proposalId=sha("proposal:"+key);
      this.run(`INSERT INTO proposals(id,project_id,target_artifact_id,proposed_scope,kind,idempotency_key,status,candidate_digest,staged_path,created_at,updated_at)
        VALUES(?,?,?,'project','memory',?,'promoted',?,'memory',?,?)`,proposalId,event.projectId,artifactId,"lesson:"+key,sha(description),t,t);
      this.run(`INSERT INTO memories(id,project_id,scope,kind,title,content,confidence,status,artifact_version_id,created_at,updated_at)
        VALUES(?,?,'project','lesson',?,?,0.9,'published',?,?,?)`,key,event.projectId,title,description,versionId,t,t);
      this.run("INSERT INTO memory_evidence(memory_id,evidence_id) VALUES(?,?),(?,?)",key,failure.evidence_id,key,evidence.id);
      this.run("INSERT INTO releases(id,artifact_id,artifact_version_id,state,published_at,created_at) VALUES(?,?,?,'active',?,?)",sha("release:"+key),artifactId,versionId,t,t);
      return true;
    });
  }
  search(request:ContextRequest,allowGlobal=false){
    this.assertAuthorized(request.sourceInstanceId,request.projectId,request.provider);
    const terms=request.query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0,12)??[];
    if(!terms.length)return {schemaVersion:1,items:[],estimatedTokens:0,truncated:false};
    const match=terms.map(x=>'"'+x.replace(/"/g,"")+'"').join(" OR ");
    const rows=this.all(`SELECT m.*,bm25(memory_fts) score FROM memory_fts JOIN memories m ON m.rowid=memory_fts.rowid
      WHERE memory_fts MATCH ? AND m.status='published' AND (m.valid_until IS NULL OR m.valid_until>?)
      AND ((m.scope='project' AND m.project_id=?) OR (m.scope='global' AND ?=1))
      ORDER BY CASE WHEN m.project_id=? THEN 0 ELSE 1 END, score, m.confidence DESC, m.created_at DESC LIMIT ?`,
      match,now(),request.projectId,allowGlobal?1:0,request.projectId,Math.min(request.maxItems+1,21));
    let tokens=0;const items:Row[]=[];
    for(const row of rows){
      const count=Math.ceil((row.title.length+row.content.length)/4);
      if(items.length>=request.maxItems || tokens+count>request.maxTokens)break;
      const evidenceIds=this.all("SELECT evidence_id FROM memory_evidence WHERE memory_id=? ORDER BY evidence_id",row.id).map(r=>r.evidence_id);
      items.push({memoryId:row.id,scope:row.scope,title:row.title,content:row.content,evidenceIds,artifactVersionId:row.artifact_version_id});
      tokens+=count;
    }
    return {schemaVersion:1,items,estimatedTokens:tokens,truncated:items.length<rows.length};
  }
  list(kind:"artifacts"|"evaluations",projectId:string,limit=20){
    if(!this.get("SELECT id FROM projects WHERE id=?",projectId))throw new ContractError("Unknown project",403);
    if(kind==="artifacts")return this.all(`SELECT a.id artifactId,a.kind,a.logical_key logicalKey,a.scope,v.id versionId,r.state status
      FROM releases r JOIN artifacts a ON a.id=r.artifact_id JOIN artifact_versions v ON v.id=r.artifact_version_id
      WHERE a.project_id=? AND r.state IN ('active','superseded','rolled_back')
      ORDER BY r.created_at DESC LIMIT ?`,projectId,limit);
    return this.all(`SELECT e.id,e.proposal_id proposalId,e.status,e.baseline_score baselineScore,
      e.candidate_score candidateScore,e.report_digest reportDigest FROM evaluations e
      JOIN proposals p ON p.id=e.proposal_id WHERE p.project_id=? ORDER BY e.created_at DESC LIMIT ?`,projectId,limit);
  }
  stats(){return {events:this.get("SELECT COUNT(*) n FROM events")?.n??0,queued:this.get("SELECT COUNT(*) n FROM processing_jobs WHERE status IN ('queued','leased')")?.n??0,dead:this.get("SELECT COUNT(*) n FROM processing_jobs WHERE status='dead'")?.n??0,memories:this.get("SELECT COUNT(*) n FROM memories WHERE status='published'")?.n??0};}
}
