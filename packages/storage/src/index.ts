import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface StorageEvent {
  provider: "opencode" | "codex"; schemaVersion: 1; eventId: string; sourceInstanceId: string; projectId: string;
  nativeSessionId: string; eventType: "session.started" | "session.ended" | "turn.started" | "turn.ended" | "tool.started" | "tool.completed" | "subagent.started" | "subagent.ended" | "message.corrected" | "provider.diagnostic";
  occurredAt: string; observedAt: string; privacyClass: "metadata" | "redacted_excerpt";
  outcome?: "succeeded" | "failed" | "cancelled" | "blocked" | "unknown";
  sessionId?: string | null; metadata?: Record<string, unknown>;
}
export interface Registration { sourceInstanceId: string; projectId: string }
export class StorageError extends Error { constructor(readonly code: "FORBIDDEN" | "CONFLICT", message: string) { super(message); this.name = "StorageError"; } }
export class SqliteStorage {
  readonly db: DatabaseSync;
  constructor(path: string, options: { timeout?: number } = {}) {
    this.db = new DatabaseSync(path, { timeout: options.timeout ?? 5000 });
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    const migrations = [
      readFileSync(fileURLToPath(new URL("../../../migrations/0001_init.sql", import.meta.url)), "utf8"),
      readFileSync(fileURLToPath(new URL("../../../migrations/0002_source_project_bindings.sql", import.meta.url)), "utf8"),
    ];
    for (let version = 0; version < migrations.length; version++) {
      const current = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (current <= version) withRetry(() => this.db.exec(migrations[version]!));
    }
  }
  register(reg: Registration): void {
    withRetry(() => this.db.exec("BEGIN IMMEDIATE"));
    let active = true;
    try {
      const now = new Date().toISOString();
      this.db.prepare("INSERT OR IGNORE INTO projects(id,display_name,created_at,updated_at) VALUES(?,?,?,?)").run(reg.projectId, reg.projectId, now, now);
      this.db.prepare("INSERT OR IGNORE INTO provider_instances(id,provider,launcher,profile_fingerprint,capabilities_json,created_at,updated_at) VALUES(?,'opencode','unknown',?,'{}',?,?)").run(reg.sourceInstanceId, reg.sourceInstanceId, now, now);
      const p = this.db.prepare("SELECT collection_enabled FROM projects WHERE id=?").get(reg.projectId) as {collection_enabled:number};
      const s = this.db.prepare("SELECT 1 FROM provider_instances WHERE id=?").get(reg.sourceInstanceId);
      if (!s || !p || !p.collection_enabled) throw new StorageError("FORBIDDEN", "Source or project is unavailable");
      const prior = this.db.prepare("SELECT 1 FROM source_project_bindings WHERE source_instance_id=?").get(reg.sourceInstanceId);
      if (prior && !this.db.prepare("SELECT 1 FROM source_project_bindings WHERE source_instance_id=? AND project_id=?").get(reg.sourceInstanceId, reg.projectId)) throw new StorageError("CONFLICT", "Source is already bound to another project");
      this.db.prepare("INSERT OR IGNORE INTO source_project_bindings(source_instance_id,project_id,created_at) VALUES(?,?,?)").run(reg.sourceInstanceId, reg.projectId, now);
      this.db.exec("COMMIT"); active = false;
    } catch (e) { if (active) this.db.exec("ROLLBACK"); throw e; }
  }
  ingest(event: StorageEvent): { disposition: "accepted" | "duplicate"; sequence: number } {
    const now = new Date().toISOString(), payload = canonical(event), digest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
    withRetry(() => this.db.exec("BEGIN IMMEDIATE"));
    let active = true;
    try {
      const binding = this.db.prepare("SELECT p.collection_enabled FROM source_project_bindings b JOIN projects p ON p.id=b.project_id JOIN provider_instances s ON s.id=b.source_instance_id WHERE b.source_instance_id=? AND b.project_id=? AND s.provider=?").get(event.sourceInstanceId,event.projectId,event.provider) as {collection_enabled:number}|undefined;
      if (!binding || !binding.collection_enabled) throw new StorageError("FORBIDDEN", "Source is not authorized for this project");
      const prior = this.db.prepare("SELECT sequence,payload_digest FROM events WHERE source_instance_id=? AND event_id=?").get(event.sourceInstanceId,event.eventId) as {sequence:number;payload_digest:string}|undefined;
      if (prior) { if (prior.payload_digest !== digest) throw new StorageError("CONFLICT", "Event ID already exists with a different payload"); this.db.exec("COMMIT"); active = false; return {disposition:"duplicate",sequence:prior.sequence}; }
      const r=this.db.prepare("INSERT INTO events(source_instance_id,event_id,project_id,session_id,native_session_id,event_type,schema_version,occurred_at,observed_at,received_at,outcome,privacy_class,payload_digest,sanitized_payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(event.sourceInstanceId,event.eventId,event.projectId,event.sessionId??null,event.nativeSessionId,event.eventType,event.schemaVersion,event.occurredAt,event.observedAt,now,event.outcome??null,event.privacyClass,digest,payload);
      this.db.prepare("INSERT INTO processing_jobs(id,idempotency_key,event_sequence,project_id,job_type,available_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,'classify',?,'{}',?,?)").run(crypto.randomUUID(),`classify:${event.sourceInstanceId}:${event.eventId}`,Number(r.lastInsertRowid),event.projectId,now,now,now);
      this.db.exec("COMMIT"); active = false; return {disposition:"accepted",sequence:Number(r.lastInsertRowid)};
    } catch(e) { if (active) this.db.exec("ROLLBACK"); throw e; }
  }
  lookup(sourceInstanceId:string,eventId:string): unknown { return this.db.prepare("SELECT * FROM events WHERE source_instance_id=? AND event_id=?").get(sourceInstanceId,eventId); }
  close(): void { this.db.close(); }
}
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
function withRetry<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try { return operation(); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!/SQLITE_BUSY|SQLITE_LOCKED/.test(code) || attempt >= 3) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
    }
  }
}
