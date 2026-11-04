import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
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
  // Normalize before matching so full-width or zero-width tricks cannot hide credentials or paths.
  const text=content.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF\u2060]/g,"");
  if(/(?:<script|<\|im_start\|>|ignore (?:all|previous) instructions|curl\s+[^\n]*\|\s*(?:bash|sh)|wget\s+[^\n]*\|\s*(?:bash|sh))/i.test(text))return "injection_or_script";
  const secrets:[RegExp,string][]=[
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i,"private_key"],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,"github_token"],
    [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/,"api_key"],
    [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,"slack_token"],
    [/\bAKIA[0-9A-Z]{12,}\b/,"aws_key"],
    [/\bAIza[0-9A-Za-z_-]{30,}\b/,"google_key"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,"jwt"],
    [/\b(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i,"credential_assignment"],
    [/\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,"authorization_header"],
    [/https?:\/\/[^\s/:@]+:[^\s/@]+@/i,"url_credentials"],
    [/\$\{\s*[A-Z_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)[A-Z_]*\s*\}?/i,"env_reference"]
  ];
  for(const [pattern,name] of secrets)if(pattern.test(text))return "secret_detected:"+name;
  const paths:[RegExp,string][]=[
    [/\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)\b/i,"windows_profile"],
    [/\b[A-Za-z]:[\\/]+[^\\/\r\n]+[\\/]+AppData\b/i,"windows_appdata"],
    [/(?:^|[\s"'(])[\\/]{2}[^\\/\s]+[\\/]+[^\\/\s]+[\\/]+(?:Users|home)[\\/]/i,"unc_profile"],
    [/(?:^|[\s"'(])[\\/](?:home|Users)[\\/]+[^\\/\s]+/i,"posix_profile"],
    [/(?:^|[\s"'(])[\\/]root[\\/]/i,"root_home"],
    [/(?:^|[\s"'(])[\\/](?:private[\\/]var[\\/]folders|var[\\/]folders)[\\/]/i,"macos_temp_profile"],
    [/\b(?:file|vscode-file):\/\/\//i,"file_url"],
    [/(?:\$HOME|%USERPROFILE%)[\\/]/i,"env_profile"],
    [/~\/(?:\.ssh|\.aws|\.config|\.gnupg)[\\/]/i,"secret_config_dir"]
  ];
  for(const [pattern,name] of paths)if(pattern.test(text))return "private_path_detected:"+name;
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
    const logicalKey=this.store.get("SELECT logical_key FROM artifacts WHERE id=?",proposal.target_artifact_id)?.logical_key??"";
    const valid=contentDigest(content)===proposal.candidate_digest&&!safety(content,proposal.kind as Kind,logicalKey);
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
  /**
   * Publish in two phases: reserve an immutable version and a staged release in
   * SQLite, then write files, then activate. Failures restore the previous
   * bytes and leave no release active, so a retry or rollback stays possible.
   */
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
    const staged=this.store.get(`SELECT r.id release_id,r.git_revision,v.id version_id,v.storage_path,v.version_number,v.content_digest
      FROM releases r JOIN artifact_versions v ON v.id=r.artifact_version_id
      WHERE v.source_proposal_id=? AND r.state='staged' ORDER BY r.created_at DESC LIMIT 1`,id);
    if(staged && staged.content_digest!==p.candidate_digest)throw new Error("Staged publication drift");
    if(!staged){
      const current=existsSync(target)?contentDigest(readFileSync(target,"utf8")):null;
      if(current && (!prev || current!==prev.content_digest))throw new Error("Managed target drifted; refusing overwrite");
      const busy=this.store.get(`SELECT r.id FROM releases r JOIN artifact_versions v ON v.id=r.artifact_version_id
        WHERE r.artifact_id=? AND r.state='staged' AND v.source_proposal_id<>?`,a.id,id);
      if(busy)throw new Error("Another publication is in progress");
    }
    const t=stamp();
    let releaseId:string,versionId:string;
    if(staged){
      releaseId=staged.release_id as string;versionId=staged.version_id as string;
    }else{
      const number=Number(this.store.get("SELECT COALESCE(MAX(version_number),0) n FROM artifact_versions WHERE artifact_id=?",a.id)?.n)+1;
      releaseId=randomUUID();versionId=randomUUID();
      const versionFile=join(this.root,"artifacts","versions",a.id,String(number),"SKILL.md");
      this.store.txn(()=>{
        // Re-check inside the write transaction: reservation is the serialization point.
        if(this.store.get("SELECT id FROM releases WHERE artifact_id=? AND state='staged'",a.id))throw new Error("Another publication is in progress");
        this.store.run(`INSERT INTO artifact_versions(id,artifact_id,source_proposal_id,version_number,content_digest,storage_path,status,created_at)
          VALUES(?,?,?,?,?,?,'draft',?)`,versionId,a.id,id,number,p.candidate_digest,versionFile,t);
        this.store.run(`INSERT INTO releases(id,artifact_id,artifact_version_id,previous_release_id,state,created_at)
          VALUES(?,?,?,?,'staged',?)`,releaseId,a.id,versionId,prev?.id??null,t);
        this.store.run(`INSERT INTO publication_targets(id,release_id,provider,install_scope,target_fingerprint,status)
          VALUES(?,?,'opencode','project',?,'planned')`,randomUUID(),releaseId,sha(target));
      });
    }
    const versionFile=this.store.get("SELECT storage_path FROM artifact_versions WHERE id=?",versionId)!.storage_path as string;
    let wroteTarget=false;
    try{
      if(!existsSync(versionFile) || contentDigest(readFileSync(versionFile,"utf8"))!==p.candidate_digest)atomicPrivate(versionFile,source);
      // Git only runs inside Harness-owned history; never in a user project.
      const history=join(this.root,"artifacts","history");
      mkdirSync(history,{recursive:true,mode:0o700});
      const cmd=(...args:string[])=>spawnSync("git",args,{cwd:history,encoding:"utf8",timeout:3000});
      if(!existsSync(join(history,".git")) && cmd("init").status!==0)throw new Error("Local Git required for publication");
      const name=versionId+".md";
      const tracked=join(history,name);
      let revision:string|undefined;
      // A resumed publication reuses the commit that already contains these bytes.
      if(cmd("cat-file","-e","HEAD:"+name).status===0){
        const committed=cmd("show","HEAD:"+name);
        if(committed.status===0 && contentDigest(committed.stdout)===p.candidate_digest)revision=cmd("rev-parse","HEAD").stdout.trim();
      }
      if(!revision){
        if(!existsSync(tracked) || contentDigest(readFileSync(tracked,"utf8"))!==p.candidate_digest)atomicPrivate(tracked,source);
        if(cmd("add",name).status!==0)throw new Error("Git staging failed");
        const commit=cmd("-c","user.name=Adaptive Harness","-c","user.email=harness@localhost","commit","-m","publish "+versionId);
        if(commit.status!==0)throw new Error("Git revision failed");
        revision=cmd("rev-parse","HEAD").stdout.trim();
      }
      this.store.run("UPDATE releases SET git_revision=? WHERE id=? AND state='staged'",revision,releaseId);
      // The prepared bytes are already immutable; atomic replacement is limited to our managed path.
      atomicPrivate(target+".next-"+releaseId,source);
      renameSync(target+".next-"+releaseId,target);
      wroteTarget=true;
      this.store.txn(()=>{
        this.store.run("UPDATE releases SET state='superseded' WHERE artifact_id=? AND state='active'",a.id);
        const activated=this.store.run("UPDATE releases SET state='active',published_at=? WHERE id=? AND state='staged'",t,releaseId);
        if(Number(activated.changes)!==1)throw new Error("Publication state changed");
        this.store.run("UPDATE artifact_versions SET status='published' WHERE id=? AND status='draft'",versionId);
        this.store.run("UPDATE publication_targets SET status='installed',installed_digest=?,applied_at=? WHERE release_id=? AND status='planned'",p.candidate_digest,t,releaseId);
        this.store.run("UPDATE proposals SET status='promoted',updated_at=? WHERE id=? AND status='eligible'",t,id);
        this.audit(p.project_id,"release.active",id);
      });
    }catch(error){
      // Never leave self-inflicted drift: put the previous verified bytes back.
      if(wroteTarget||existsSync(target+".next-"+releaseId)){
        try{
          if(prev){
            const older=this.store.get("SELECT storage_path,content_digest FROM artifact_versions WHERE id=?",prev.artifact_version_id);
            const body=older&&existsSync(older.storage_path)?readFileSync(older.storage_path,"utf8"):undefined;
            if(older&&body!==undefined && contentDigest(body)===older.content_digest){
              atomicPrivate(target+".restore-"+releaseId,body);renameSync(target+".restore-"+releaseId,target);
            }
          }else if(existsSync(target))unlinkSync(target);
        }catch{}
        try{unlinkSync(target+".next-"+releaseId);}catch{}
      }
      this.store.txn(()=>{
        this.store.run("UPDATE releases SET state='failed' WHERE id=? AND state='staged'",releaseId);
        this.store.run("UPDATE artifact_versions SET status='retired' WHERE id=? AND status='draft'",versionId);
        this.store.run("UPDATE publication_targets SET status='failed' WHERE release_id=? AND status='planned'",releaseId);
      });
      throw error;
    }
    return releaseId;
  }
  /** Restore the previous verified version, never reset the project Git working copy. */
  rollback(id:string):string{
    const r=this.store.get("SELECT * FROM releases WHERE id=?",id);
    if(!r || !r.previous_release_id || (r.state!=="active" && r.state!=="rolled_back"))throw new Error("No rollback target");
    const older=this.store.get(`SELECT r.*,v.storage_path,v.content_digest FROM releases r
      JOIN artifact_versions v ON v.id=r.artifact_version_id WHERE r.id=?`,r.previous_release_id);
    const a=this.store.get("SELECT * FROM artifacts WHERE id=?",r.artifact_id);
    if(!a)throw new Error("Artifact not found");
    const root=this.store.get("SELECT local_root_path FROM project_roots WHERE project_id=? ORDER BY verified_at LIMIT 1",a.project_id)?.local_root_path;
    const target=root&&join(root,".opencode","skills","adaptive-"+a.logical_key,"SKILL.md");
    const active=this.store.get("SELECT storage_path,content_digest FROM artifact_versions WHERE id=?",r.artifact_version_id);
    if(!older || !target || !active)throw new Error("Cannot rollback drifted target");
    const content=readFileSync(older.storage_path,"utf8");
    if(contentDigest(content)!==older.content_digest)throw new Error("Rollback version corrupted");
    const current=existsSync(target)?contentDigest(readFileSync(target,"utf8")):null;
    const alreadyRestored=current===older.content_digest;
    if(r.state==="rolled_back"){
      if(!alreadyRestored)throw new Error("Cannot rollback drifted target");
      return older.id as string;
    }
    if(!alreadyRestored && current!==active.content_digest)throw new Error("Cannot rollback drifted target");
    let wrote=false;
    if(!alreadyRestored){
      atomicPrivate(target+".rollback",content);renameSync(target+".rollback",target);
      wrote=true;
    }
    try{
      this.store.txn(()=>{
        const changed=this.store.run("UPDATE releases SET state='rolled_back' WHERE id=? AND state='active'",id);
        if(Number(changed.changes)!==1)throw new Error("Release state changed");
        this.store.run("UPDATE releases SET state='active' WHERE id=? AND state='superseded'",older.id);
        this.store.run("UPDATE publication_targets SET status='removed' WHERE release_id=?",id);
        this.store.run("UPDATE artifact_versions SET status='retired' WHERE id=?",r.artifact_version_id);
        this.store.run("UPDATE artifact_versions SET status='published' WHERE id=?",older.artifact_version_id);
        this.audit(a.project_id,"release.rollback",id);
      });
    }catch(error){
      if(wrote){
        try{
          const body=readFileSync(active.storage_path,"utf8");
          if(contentDigest(body)===active.content_digest){
            atomicPrivate(target+".restore-rollback",body);renameSync(target+".restore-rollback",target);
          }
        }catch{}
      }
      throw error;
    }
    return older.id as string;
  }
}
