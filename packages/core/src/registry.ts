import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { Store, sha } from "../../storage/src/store.ts";
import { atomicPrivate } from "./config.ts";

/** M2 registry: immutable proposals and fail-closed replay-gated promotion. */
type Kind="skill"|"rule";
export interface ReplayResult {
  readonly isolated:boolean;
  readonly baselineFixtureDigest:string;
  readonly candidateFixtureDigest:string;
  readonly triggerBaselinePassed:boolean;
  readonly triggerCandidatePassed:boolean;
  readonly regressionBaselinePassed:number;
  readonly regressionCandidatePassed:number;
  readonly regressionTotal:number;
  readonly runnerVersion:string;
}
export interface ReplayPort {
  // Implementations must execute in externally verified isolated workspaces.
  compare(input:{projectId:string;kind:Kind;logicalKey:string;candidatePath:string;triggerEvidenceIds:string[]}):Promise<ReplayResult|undefined>;
}
function safety(content:string,kind:Kind,key:string):string|undefined {
  if(!/^[a-z][a-z0-9-]{1,62}$/.test(key))return "invalid_logical_key";
  if(content.length<20 || content.length>32768)return "invalid_content_size";
  if(/(?:-----BEGIN .*PRIVATE KEY-----|ghp_[A-Za-z0-9]{16}|sk-[A-Za-z0-9]{16}|\$\{\s*(?:TOKEN|SECRET|API_KEY)|https?:\/\/[^\s]+@)/i.test(content))return "secret_detected";
  if(/(?:<script|<\|im_start\|>|ignore (?:all|previous) instructions|curl\s+[^\n]*\|\s*(?:bash|sh)|wget\s+[^\n]*\|\s*(?:bash|sh))/i.test(content))return "injection_or_script";
  if(/(?:[A-Z]:\\Users\\|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/.test(content))return "private_path_detected";
  if(kind==="skill" && !/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(content))return "invalid_skill_frontmatter";
  if(kind==="skill" && !/^name:\s*[\w-]+\s*$/m.test(content))return "missing_skill_name";
  return undefined;
}
const stamp=()=>new Date().toISOString();
const contentDigest=(s:string)=>sha(s);
export class Registry {
  readonly store:Store;readonly root:string;readonly runner?:ReplayPort;
  constructor(store:Store,root:string,runner?:ReplayPort){this.store=store;this.root=root;this.runner=runner;}
  /** A new digest yields a new immutable proposal. Never globablize client evidence. */
  propose(input:{projectId:string;kind:Kind;logicalKey:string;content:string;evidenceIds:string[]}){
    if(input.kind!=="skill" && input.kind!=="rule")throw new Error("Unsupported proposal kind");
    const issue=safety(input.content,input.kind,input.logicalKey);
    if(issue)throw new Error(issue);
    const evidence=[...new Set(input.evidenceIds)].sort();
    if(evidence.length<2)throw new Error("At least two independent evidence records required");
    const digest=contentDigest(input.content);
    const idempotency=sha(JSON.stringify([input.projectId,input.kind,input.logicalKey,digest,evidence]));
    const file=join(this.root,"artifacts","candidates",digest.slice(7)+".md");
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    if(existsSync(file)){
      if(contentDigest(readFileSync(file,"utf8"))!==digest)throw new Error("Candidate content drift");
    }else atomicPrivate(file,input.content);
    return this.store.txn(()=>{
      if(!this.store.get("SELECT id FROM projects WHERE id=?",input.projectId))throw new Error("Unknown project");
      for(const e of evidence){
        if(!this.store.get("SELECT id FROM evidence WHERE id=? AND project_id=?",e,input.projectId))throw new Error("Cross-project or absent evidence");
      }
      const old=this.store.get("SELECT id FROM proposals WHERE idempotency_key=?",idempotency);
      if(old)return old.id as string;
      const t=stamp();
      let artifact=this.store.get("SELECT id FROM artifacts WHERE kind=? AND scope='project' AND project_id=? AND logical_key=?",input.kind,input.projectId,input.logicalKey);
      if(!artifact){
        const id=randomUUID();
        this.store.run("INSERT INTO artifacts(id,kind,logical_key,scope,project_id,created_at) VALUES(?,?,?,'project',?,?)",id,input.kind,input.logicalKey,input.projectId,t);
        artifact={id};
      }
      const id=randomUUID();
      this.store.run(`INSERT INTO proposals(id,project_id,target_artifact_id,proposed_scope,kind,idempotency_key,status,candidate_digest,staged_path,created_at,updated_at)
        VALUES(?,?,?,'project',?,?,'draft',?,?,?,?)`,id,input.projectId,artifact.id,input.kind,idempotency,digest,file,t,t);
      for(const e of evidence)this.store.run("INSERT INTO proposal_evidence(proposal_id,evidence_id) VALUES(?,?)",id,e);
      this.audit(input.projectId,"proposal.created",id);
      return id;
    });
  }
  private audit(project:string,action:string,id:string){
    this.store.run(`INSERT INTO audit_log(project_id,actor_type,action,subject_type,subject_id,created_at)
      VALUES(?,'publisher',?,'proposal',?,?)`,project,action,id,stamp());
  }
  /** Only a trusted ReplayPort supplies independent measured outcomes. Default: inconclusive. */
  async evaluate(id:string):Promise<string>{
    const proposal=this.store.get("SELECT * FROM proposals WHERE id=?",id);
    if(!proposal || !["draft","evaluating"].includes(proposal.status))throw new Error("Proposal not evaluable");
    const evidence=this.store.all("SELECT evidence_id FROM proposal_evidence WHERE proposal_id=?",id).map(x=>x.evidence_id as string);
    const content=readFileSync(proposal.staged_path,"utf8");
    const valid=contentDigest(content)===proposal.candidate_digest&&!safety(content,proposal.kind,proposal.kind==="skill"?
      (this.store.get("SELECT logical_key FROM artifacts WHERE id=?",proposal.target_artifact_id)?.logical_key||""):this.store.get("SELECT logical_key FROM artifacts WHERE id=?",proposal.target_artifact_id)?.logical_key||"");
    const evaluationId=randomUUID(),t=stamp();
    this.store.txn(()=>{
      this.store.run("UPDATE proposals SET status='evaluating',updated_at=? WHERE id=? AND status='draft'",t,id);
      this.store.run("INSERT INTO evaluations(id,proposal_id,status,created_at,started_at) VALUES(?,?,'running',?,?)",evaluationId,id,t,t);
    });
    let report:ReplayResult|undefined;
    if(valid && this.runner){
      try{report=await this.runner.compare({projectId:proposal.project_id,kind:proposal.kind,
        logicalKey:this.store.get("SELECT logical_key FROM artifacts WHERE id=?",proposal.target_artifact_id)?.logical_key,
        candidatePath:proposal.staged_path,triggerEvidenceIds:evidence});}
      catch{report=undefined;}
    }
    const pass=!!(report?.isolated && report.baselineFixtureDigest===report.candidateFixtureDigest &&
      report.runnerVersion && report.regressionTotal>0 && report.regressionBaselinePassed===report.regressionTotal &&
      report.regressionCandidatePassed===report.regressionTotal &&
      !report.triggerBaselinePassed && report.triggerCandidatePassed);
    const status=!valid?"failed":!report?"inconclusive":pass?"passed":"failed";
    const baseline=report?(Number(report.triggerBaselinePassed)+report.regressionBaselinePassed)/(report.regressionTotal+1):null;
    const candidate=report?(Number(report.triggerCandidatePassed)+report.regressionCandidatePassed)/(report.regressionTotal+1):null;
    const reportText=JSON.stringify(report??{reason:valid?"No isolated replay runner configured":"Static/security gate failed"});
    const digest=contentDigest(reportText);
    const path=join(this.root,"artifacts","evaluations",evaluationId+".json");
    atomicPrivate(path,reportText);
    this.store.txn(()=>{
      this.store.run(`UPDATE evaluations SET status=?,baseline_score=?,candidate_score=?,sample_count=?,
        report_digest=?,report_path=?,evaluator_version=?,finished_at=? WHERE id=?`,
        status,baseline,candidate,report?.regressionTotal??0,digest,path,report?.runnerVersion??"static-v1",stamp(),evaluationId);
      this.store.run("UPDATE proposals SET status=?,updated_at=? WHERE id=?",pass?"eligible":"rejected",stamp(),id);
      this.audit(proposal.project_id,"evaluation."+status,id);
    });
    return evaluationId;
  }
  /** Publish a managed skill only, after a reproduced improvement and zero regressions. */
  publish(id:string):string{
    const p=this.store.get("SELECT * FROM proposals WHERE id=?",id);
    if(!p || p.status!=="eligible" || p.proposed_scope!=="project" || p.kind!=="skill")throw new Error("Not eligible for native publication");
    const e=this.store.get("SELECT * FROM evaluations WHERE proposal_id=? AND status='passed' ORDER BY created_at DESC LIMIT 1",id);
    if(!e || !e.report_digest || !e.report_path || contentDigest(readFileSync(e.report_path,"utf8"))!==e.report_digest)throw new Error("Evaluation missing or drifted");
    const a=this.store.get("SELECT * FROM artifacts WHERE id=?",p.target_artifact_id);
    const root=this.store.get("SELECT local_root_path FROM project_roots WHERE project_id=? ORDER BY verified_at LIMIT 1",p.project_id)?.local_root_path as string|undefined;
    if(!a || !root)throw new Error("Workspace not registered");
    const source=readFileSync(p.staged_path,"utf8");
    if(contentDigest(source)!==p.candidate_digest || safety(source,"skill",a.logical_key))throw new Error("Unsafe candidate");
    const target=join(root,".opencode","skills","adaptive-"+a.logical_key,"SKILL.md");
    const prev=this.store.get(`SELECT r.*,v.content_digest FROM releases r JOIN artifact_versions v ON v.id=r.artifact_version_id
      WHERE r.artifact_id=? AND r.state='active'`,a.id);
    const current=existsSync(target)?contentDigest(readFileSync(target,"utf8")):null;
    if(current && (!prev || current!==prev.content_digest))throw new Error("Managed target drifted; refusing overwrite");
    const number=Number(this.store.get("SELECT COALESCE(MAX(version_number),0) n FROM artifact_versions WHERE artifact_id=?",a.id)?.n)+1;
    const versionId=randomUUID(),releaseId=randomUUID(),t=stamp();
    const versionFile=join(this.root,"artifacts","versions",a.id,String(number),"SKILL.md");
    atomicPrivate(versionFile,source);
    // Git only runs inside Harness-owned history; never in a user project.
    const history=join(this.root,"artifacts","history");
    mkdirSync(history,{recursive:true,mode:0o700});
    const cmd=(...args:string[])=>spawnSync("git",args,{cwd:history,encoding:"utf8",timeout:3000});
    if(!existsSync(join(history,".git")) && cmd("init").status!==0)throw new Error("Local Git required for publication");
    const tracked=join(history,versionId+".md");
    atomicPrivate(tracked,source);
    if(cmd("add",versionId+".md").status!==0)throw new Error("Git staging failed");
    const commit=cmd("-c","user.name=Adaptive Harness","-c","user.email=harness@localhost","commit","-m","publish "+versionId);
    if(commit.status!==0)throw new Error("Git revision failed");
    const revision=cmd("rev-parse","HEAD").stdout.trim();
    // The prepared bytes are already immutable; atomic replacement is limited to our managed path.
    atomicPrivate(target+".next-"+releaseId,source);
    renameSync(target+".next-"+releaseId,target);
    this.store.txn(()=>{
      this.store.run(`INSERT INTO artifact_versions(id,artifact_id,source_proposal_id,version_number,content_digest,storage_path,status,created_at)
        VALUES(?,?,?,?,?,?,'published',?)`,versionId,a.id,id,number,p.candidate_digest,versionFile,t);
      if(prev)this.store.run("UPDATE releases SET state='superseded' WHERE id=? AND state='active'",prev.id);
      this.store.run(`INSERT INTO releases(id,artifact_id,artifact_version_id,previous_release_id,state,git_revision,published_at,created_at)
        VALUES(?,?,?,?, 'active',?,?,?)`,releaseId,a.id,versionId,prev?.id??null,revision,t,t);
      this.store.run(`INSERT INTO publication_targets(id,release_id,provider,install_scope,target_fingerprint,installed_digest,status,applied_at)
        VALUES(?,?,'opencode','project',?,?,'installed',?)`,randomUUID(),releaseId,sha(target),p.candidate_digest,t);
      this.store.run("UPDATE proposals SET status='promoted',updated_at=? WHERE id=?",t,id);
      this.audit(p.project_id,"release.active",id);
    });
    return releaseId;
  }
  /** Restore the previous verified version, never reset the project Git working copy. */
  rollback(id:string):string{
    const r=this.store.get("SELECT * FROM releases WHERE id=? AND state='active'",id);
    if(!r || !r.previous_release_id)throw new Error("No rollback target");
    const older=this.store.get(`SELECT r.*,v.storage_path,v.content_digest FROM releases r
      JOIN artifact_versions v ON v.id=r.artifact_version_id WHERE r.id=?`,r.previous_release_id);
    const a=this.store.get("SELECT * FROM artifacts WHERE id=?",r.artifact_id);
    const root=this.store.get("SELECT local_root_path FROM project_roots WHERE project_id=? ORDER BY verified_at LIMIT 1",a?.project_id)?.local_root_path;
    const target=root&&join(root,".opencode","skills","adaptive-"+a.logical_key,"SKILL.md");
    const active=this.store.get("SELECT content_digest FROM artifact_versions WHERE id=?",r.artifact_version_id);
    if(!older || !target || !active || !existsSync(target) || contentDigest(readFileSync(target,"utf8"))!==active.content_digest)throw new Error("Cannot rollback drifted target");
    const content=readFileSync(older.storage_path,"utf8");
    if(contentDigest(content)!==older.content_digest)throw new Error("Rollback version corrupted");
    atomicPrivate(target+".rollback",content);renameSync(target+".rollback",target);
    this.store.txn(()=>{
      this.store.run("UPDATE releases SET state='rolled_back' WHERE id=? AND state='active'",id);
      this.store.run("UPDATE releases SET state='active' WHERE id=? AND state='superseded'",older.id);
      this.store.run("UPDATE publication_targets SET status='removed' WHERE release_id=?",id);
      this.audit(a.project_id,"release.rollback",id);
    });
    return older.id;
  }
}
