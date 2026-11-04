import { ContractError } from "../../contracts/src/index.ts";
import { Store } from "../../storage/src/store.ts";

/**
 * Read-only projection of persisted Harness activity.
 * Queries are fixed, keyset-paginated and never expose paths, secrets or raw transcripts.
 */
export const recordKinds = ["events","sessions","jobs","memories","proposals","evaluations","releases","audit","sources","inference"] as const;
export type RecordKind = typeof recordKinds[number];
export interface HistoryInput {
  kind: RecordKind;
  projectId?: string;
  before?: number;
  limit?: number;
}
type Row = Record<string, any>;
const sources: Record<RecordKind,{query:string;alias:string;projectColumn:string}> = {
  events: {
    query:`SELECT e.sequence AS cursor,e.event_id AS id,e.project_id AS projectId,e.source_instance_id AS sourceId,
      e.native_session_id AS sessionId,e.event_type AS type,e.outcome,e.occurred_at AS occurredAt,
      e.received_at AS at,e.sanitized_payload_json AS payload
      FROM events e`,
    alias:"e",projectColumn:"e.project_id"
  },
  sessions: {
    query:`SELECT s.rowid AS cursor,s.id,s.project_id AS projectId,s.provider_instance_id AS sourceId,
      s.native_session_id AS sessionId,s.parent_session_id AS parentSessionId,
      s.status AS lifecycleStatus,
      CASE WHEN s.status='running' AND x.status IS NULL THEN 'unknown'
        WHEN s.status='running' AND x.status IN ('succeeded','failed','cancelled')
        THEN 'idle' ELSE s.status END AS status,
      COALESCE(x.status,'unknown') AS executionStatus,
      x.started_at AS executionStartedAt,x.finished_at AS executionFinishedAt,
      s.started_at AS at,s.finished_at AS finishedAt
      FROM sessions s LEFT JOIN session_execution_state x ON x.session_id=s.id`,
    alias:"s",projectColumn:"s.project_id"
  },
  jobs: {
    query:`SELECT j.rowid AS cursor,j.id,j.project_id AS projectId,j.event_sequence AS eventSequence,
      j.job_type AS type,j.status,j.attempts,j.max_attempts AS maxAttempts,
      j.last_error_code AS errorCode,j.available_at AS availableAt,j.created_at AS at,
      j.updated_at AS updatedAt FROM processing_jobs j`,
    alias:"j",projectColumn:"j.project_id"
  },
  memories: {
    query:`SELECT m.rowid AS cursor,m.id,m.project_id AS projectId,m.kind AS type,m.scope,m.status,
      m.title,m.content,m.confidence,m.artifact_version_id AS versionId,m.created_at AS at,
      (SELECT COUNT(*) FROM memory_evidence me WHERE me.memory_id=m.id) AS evidenceCount
      FROM memories m`,
    alias:"m",projectColumn:"m.project_id"
  },
  proposals: {
    query:`SELECT p.rowid AS cursor,p.id,p.project_id AS projectId,p.kind AS type,p.proposed_scope AS scope,
      p.status,p.candidate_digest AS digest,p.target_artifact_id AS artifactId,
      (SELECT COUNT(*) FROM proposal_evidence pe WHERE pe.proposal_id=p.id) AS evidenceCount,
      p.created_at AS at,p.updated_at AS updatedAt FROM proposals p`,
    alias:"p",projectColumn:"p.project_id"
  },
  evaluations: {
    query:`SELECT ev.rowid AS cursor,ev.id,p.project_id AS projectId,ev.proposal_id AS proposalId,
      ev.status,ev.baseline_score AS baselineScore,ev.candidate_score AS candidateScore,
      ev.sample_count AS samples,ev.report_digest AS reportDigest,
      ev.created_at AS at,ev.finished_at AS finishedAt
      FROM evaluations ev JOIN proposals p ON p.id=ev.proposal_id`,
    alias:"ev",projectColumn:"p.project_id"
  },
  releases: {
    query:`SELECT r.rowid AS cursor,r.id,a.project_id AS projectId,a.kind AS type,a.logical_key AS logicalKey,
      r.state AS status,r.artifact_id AS artifactId,r.artifact_version_id AS versionId,
      r.previous_release_id AS previousReleaseId,r.git_revision AS gitRevision,
      r.published_at AS publishedAt,r.created_at AS at
      FROM releases r JOIN artifacts a ON a.id=r.artifact_id`,
    alias:"r",projectColumn:"a.project_id"
  },
  audit: {
    query:`SELECT a.sequence AS cursor,a.project_id AS projectId,a.actor_type AS actor,
      a.action AS type,a.subject_type AS subjectType,a.subject_id AS subjectId,a.created_at AS at
      FROM audit_log a`,
    alias:"a",projectColumn:"a.project_id"
  },
  sources: {
    query:`SELECT i.rowid AS cursor,i.id,i.provider AS type,i.runtime_version AS runtimeVersion,
      i.launcher,i.profile_fingerprint AS profileFingerprint,
      i.last_doctor_at AS lastDoctorAt,i.updated_at AS at
      FROM provider_instances i`,
    alias:"i",projectColumn:"i.id"
  },
  inference: {
    query:`SELECT u.rowid AS cursor,u.id,u.project_id AS projectId,u.backend AS type,
      u.model_name AS modelName,u.input_tokens AS inputTokens,u.output_tokens AS outputTokens,
      u.estimated_cost_microusd AS estimatedCostMicrousd,u.created_at AS at
      FROM inference_usage u`,
    alias:"u",projectColumn:"u.project_id"
  }
};
export function checkProject(store:Store,projectId?:string){
  if(projectId && !store.get("SELECT id FROM projects WHERE id=?",projectId))throw new ContractError("Unknown project",403);
}
export function projectList(store:Store){
  return store.all(`SELECT p.id,p.display_name AS name,p.collection_enabled AS collectionEnabled,
    p.external_inference_enabled AS externalInferenceEnabled,p.created_at AS at,
    (SELECT COUNT(*) FROM source_project_bindings b WHERE b.project_id=p.id) AS sources
    FROM projects p ORDER BY p.display_name,p.id`);
}
export function history(store:Store,input:HistoryInput){
  const {kind,projectId}=input;
  if(!Object.prototype.hasOwnProperty.call(sources,kind))throw new ContractError("Unknown record kind");
  checkProject(store,projectId);
  const before=input.before;
  if(before!==undefined && (!Number.isSafeInteger(before)||before<1))throw new ContractError("Invalid cursor");
  const limit=input.limit??50;
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new ContractError("Invalid page limit");
  const selected=sources[kind];
  const args:unknown[]=[];
  const filters:string[]=[];
  if(projectId){
    if(kind==="sources"){
      filters.push("EXISTS (SELECT 1 FROM source_project_bindings b WHERE b.source_instance_id=i.id AND b.project_id=?)");
    }else{
      filters.push(selected.projectColumn+"=?");
    }
    args.push(projectId);
  }
  if(before!==undefined){filters.push(selected.alias+".rowid<?");args.push(before);}
  const sql=selected.query+(filters.length?" WHERE "+filters.join(" AND "):"")+
    " ORDER BY "+selected.alias+".rowid DESC LIMIT ?";
  const rows=store.all(sql,...args,limit+1);
  const hasMore=rows.length>limit;
  const items=rows.slice(0,limit).map(row=>{
    if(kind!=="events")return row;
    // Only the sanitized canonical payload metadata is returned; never raw provider content.
    const {payload,...rest}=row;
    const data=JSON.parse(payload);
    return {...rest,metadata:data.metadata??{},launcher:data.launcher??"unknown",provider:data.provider};
  });
  return {kind,items,hasMore,nextCursor:hasMore?items[items.length-1]?.cursor??null:null};
}
function count(store:Store,table:string,projectId?:string,filter?:string){
  // Only trusted, compile-time table/column names are passed by callers.
  const condition=(projectId?["project_id=?"]:[]).concat(filter?[filter]:[]);
  return Number(store.get("SELECT COUNT(*) AS n FROM "+table+(condition.length?" WHERE "+condition.join(" AND "):""),...(projectId?[projectId]:[]))?.n??0);
}
export function overview(store:Store,projectId?:string){
  checkProject(store,projectId);
  const metrics={
    events:count(store,"events",projectId),
    sessions:count(store,"sessions",projectId),
    // Only an observed execution start counts as running: an open T3 session is not a busy agent.
    running:projectId?Number(store.get(`SELECT COUNT(*) AS n FROM session_execution_state x
      JOIN sessions s ON s.id=x.session_id WHERE s.project_id=? AND s.status='running'
      AND x.status='running'`,projectId)?.n??0):
      Number(store.get(`SELECT COUNT(*) AS n FROM session_execution_state x
        JOIN sessions s ON s.id=x.session_id WHERE s.status='running'
        AND x.status='running'`)?.n??0),
    queued:count(store,"processing_jobs",projectId,"status IN ('queued','leased')"),
    retrying:count(store,"processing_jobs",projectId,"status='queued' AND attempts>0"),
    dead:count(store,"processing_jobs",projectId,"status='dead'"),
    memories:count(store,"memories",projectId,"status='published'"),
    proposals:count(store,"proposals",projectId),
    evaluations:projectId?Number(store.get(`SELECT COUNT(*) n FROM evaluations ev
      JOIN proposals p ON p.id=ev.proposal_id WHERE p.project_id=?`,projectId)?.n??0):
      Number(store.get("SELECT COUNT(*) n FROM evaluations")?.n??0),
    releases:projectId?Number(store.get(`SELECT COUNT(*) n FROM releases r
      JOIN artifacts a ON a.id=r.artifact_id WHERE a.project_id=? AND r.state='active'`,projectId)?.n??0):
      Number(store.get("SELECT COUNT(*) n FROM releases WHERE state='active'")?.n??0),
    diagnostics:count(store,"events",projectId,"event_type='provider.diagnostic'"),
    failedTools:count(store,"events",projectId,"event_type='tool.completed' AND outcome='failed'")
  };
  const params=projectId?[projectId]:[];
  const projectWhere=projectId?" WHERE project_id=?":"";
  const activity=store.all(`SELECT substr(received_at,1,13) AS hour,COUNT(*) AS events,
    SUM(CASE WHEN event_type='tool.completed' AND outcome='failed' THEN 1 ELSE 0 END) AS failures
    FROM events${projectWhere} GROUP BY substr(received_at,1,13) ORDER BY hour DESC LIMIT 24`,...params).reverse();
  const lastEventAt=store.get("SELECT MAX(received_at) AS at FROM events"+projectWhere,...params)?.at??null;
  const usage=store.get(`SELECT COALESCE(SUM(input_tokens),0) AS inputTokens,
    COALESCE(SUM(output_tokens),0) AS outputTokens,
    COALESCE(SUM(estimated_cost_microusd),0) AS estimatedCostMicrousd
    FROM inference_usage${projectWhere}`,...params);
  const jobs=store.all("SELECT status,COUNT(*) AS count FROM processing_jobs"+projectWhere+
    " GROUP BY status ORDER BY status",...params);
  return {
    protocolVersion:1,observedAt:new Date().toISOString(),projectId:projectId??null,
    projects:projectList(store),metrics,activity,lastEventAt,usage,jobs,
    recentEvents:history(store,{kind:"events",projectId,limit:8}).items,
    recentAudit:history(store,{kind:"audit",projectId,limit:8}).items,
    sources:history(store,{kind:"sources",projectId,limit:100}).items
  };
}
