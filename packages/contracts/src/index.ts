/**
 * Canonical contract validation. This validator rejects extra keys and raw bodies,
 * independently of whether a provider SDK sanitizes its callbacks.
 */
export class ContractError extends Error {
  readonly status:number;
  constructor(message: string, status = 400) { super(message);this.status=status; }
}
const eventTypes = new Set(["session.started","session.ended","turn.started","turn.ended","tool.started","tool.completed","subagent.started","subagent.ended","message.corrected","provider.diagnostic"]);
const outcomes = new Set(["succeeded","failed","cancelled","blocked","unknown"]);
const metaKeys: Record<string, "string" | "integer" | "digest"> = {
  toolName:"string",inputDigest:"digest",outputDigest:"digest",durationMs:"integer",
  inputTokens:"integer",outputTokens:"integer",cacheReadTokens:"integer",
  errorCode:"string",diagnosticCode:"string",resultCategory:"string",
  evidenceId:"string",correlationDigest:"digest"
};
const fields = new Set(["schemaVersion","eventId","sourceInstanceId","provider","providerVersion","launcher","runtimeMode","nativeSessionId","parentNativeSessionId","turnId","nativeAgentId","parentNativeAgentId","spanId","parentSpanId","projectId","eventType","occurredAt","observedAt","privacyClass","outcome","metadata"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opaque = /^[A-Za-z0-9_-]{8,128}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
export type Metadata = Partial<Record<keyof typeof metaKeys, string | number>>;
export interface CanonicalEvent {
  schemaVersion:1; eventId:string; sourceInstanceId:string; provider:"opencode"|"codex";
  providerVersion?:string|null; launcher?:"cli"|"t3"|"other"|"unknown";
  runtimeMode?:string|null; nativeSessionId:string; parentNativeSessionId?:string|null;
  turnId?:string|null; nativeAgentId?:string|null; parentNativeAgentId?:string|null;
  spanId?:string|null; parentSpanId?:string|null; projectId:string;
  eventType:string; occurredAt:string; observedAt:string; privacyClass:"metadata"|"redacted_excerpt";
  outcome?:"succeeded"|"failed"|"cancelled"|"blocked"|"unknown"; metadata?:Metadata;
}
function obj(value: unknown, label: string): Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new ContractError(label+" must be an object");
  return value as Record<string,unknown>;
}
function nonempty(value: unknown, max: number, label:string): asserts value is string {
  if(typeof value!=="string" || value.length<1 || value.length>max) throw new ContractError("Invalid "+label);
}
function iso(s: unknown): boolean { return typeof s==="string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)); }
function uniqueKeys(value:Record<string,unknown>, accepted:Set<string>) {
  for(const key of Object.keys(value)) if(!accepted.has(key)) throw new ContractError("Unknown field "+key);
}
export function parseEvent(input:unknown): CanonicalEvent {
  const x=obj(input,"event");
  uniqueKeys(x,fields);
  if(x.schemaVersion!==1) throw new ContractError("Unsupported schema version");
  if(typeof x.eventId!=="string" || !uuid.test(x.eventId)) throw new ContractError("Invalid eventId");
  if(typeof x.sourceInstanceId!=="string" || !opaque.test(x.sourceInstanceId)) throw new ContractError("Invalid sourceInstanceId");
  if(x.provider!=="opencode" && x.provider!=="codex") throw new ContractError("Invalid provider");
  nonempty(x.nativeSessionId,256,"nativeSessionId");
  if(typeof x.projectId!=="string" || !opaque.test(x.projectId)) throw new ContractError("Invalid projectId");
  if(typeof x.eventType!=="string" || !eventTypes.has(x.eventType)) throw new ContractError("Invalid eventType");
  if(!iso(x.occurredAt) || !iso(x.observedAt)) throw new ContractError("Invalid event timestamp");
  if(x.privacyClass!=="metadata" && x.privacyClass!=="redacted_excerpt") throw new ContractError("Invalid privacyClass");
  if(x.outcome!==undefined && !outcomes.has(String(x.outcome))) throw new ContractError("Invalid outcome");
  if(x.launcher!==undefined && !["cli","t3","other","unknown"].includes(String(x.launcher))) throw new ContractError("Invalid launcher");
  for(const [key,max] of [["providerVersion",64],["runtimeMode",64],["parentNativeSessionId",256],["nativeAgentId",256],["parentNativeAgentId",256],["turnId",256],["spanId",128],["parentSpanId",128]] as const) {
    if(x[key]!==undefined && x[key]!==null) nonempty(x[key],max,key);
  }
  if(x.metadata!==undefined){
    const m=obj(x.metadata,"metadata"); uniqueKeys(m,new Set(Object.keys(metaKeys)));
    for(const [key,value] of Object.entries(m)){
      const kind=metaKeys[key];
      if(kind==="integer" && (!Number.isSafeInteger(value) || (value as number)<0)) throw new ContractError("Invalid metadata."+key);
      if(kind==="digest" && (typeof value!=="string" || !digest.test(value))) throw new ContractError("Invalid metadata."+key);
      if(kind==="string" && (typeof value!=="string" || value.length>128 || /[\r\n\x00-\x1f]/.test(value))) throw new ContractError("Invalid metadata."+key);
    }
  }
  return x as unknown as CanonicalEvent;
}
export interface ContextRequest {schemaVersion:1;provider:"opencode"|"codex";sourceInstanceId:string;projectId:string;nativeSessionId:string;query:string;maxItems:number;maxTokens:number;}
export function parseContext(input:unknown):ContextRequest {
  const x=obj(input,"context");
  uniqueKeys(x,new Set(["schemaVersion","provider","sourceInstanceId","projectId","nativeSessionId","query","maxItems","maxTokens"]));
  if(x.schemaVersion!==1 || !["opencode","codex"].includes(String(x.provider)))throw new ContractError("Invalid context schema/provider");
  if(typeof x.sourceInstanceId!=="string" || !opaque.test(x.sourceInstanceId) || typeof x.projectId!=="string" || !opaque.test(x.projectId))throw new ContractError("Invalid context identity");
  nonempty(x.nativeSessionId,256,"nativeSessionId");
  nonempty(x.query,2048,"query");
  if(!Number.isInteger(x.maxItems) || (x.maxItems as number)<0 || (x.maxItems as number)>20 || !Number.isInteger(x.maxTokens) || (x.maxTokens as number)<0 || (x.maxTokens as number)>4096)throw new ContractError("Invalid context bounds");
  return x as unknown as ContextRequest;
}
export function sanitizeEvent(event:CanonicalEvent):CanonicalEvent {
  // Drop nulls and preserve a strict, serialized, allowlisted representation.
  const safe=parseEvent(event);
  return JSON.parse(JSON.stringify(safe)) as CanonicalEvent;
}
