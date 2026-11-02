import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage, StorageError, type StorageEvent } from './index.js';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'adaptive-storage-')); });
let stores: SqliteStorage[] = [];
function storage() { const db = new SqliteStorage(join(dir, 'storage.sqlite')); stores.push(db); return db; }
function event(overrides: Partial<StorageEvent> = {}): StorageEvent {
  return { provider: 'opencode', schemaVersion: 1, eventId: 'evt-1', sourceInstanceId: 'src-1', projectId: 'proj-1', nativeSessionId: 'native-1', eventType: 'turn.ended', occurredAt: '2026-11-02T10:00:00.000Z', observedAt: '2026-11-02T10:00:01.000Z', privacyClass: 'metadata', outcome: 'succeeded', metadata: { turn: 1 }, ...overrides };
}
afterEach(() => { for (const db of stores) db.close(); stores = []; if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('SqliteStorage', () => {
  it('migrates an empty database through the current schema', () => {
    const db = storage();
    expect(db.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(db.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }]);
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_project_bindings'").get()).toBeTruthy();
  });
  it('authorizes only registered source and project pairs', () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    expect(db.ingest(event()).disposition).toBe('accepted');
    expect(() => db.ingest(event({ projectId: 'proj-2' }))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => db.ingest(event({ sourceInstanceId: 'src-2' }))).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => db.register({ sourceInstanceId: 'src-1', projectId: 'proj-2' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('writes an event and its classify job in one transaction', () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    const result = db.ingest(event());
    expect(result).toMatchObject({ disposition: 'accepted', sequence: expect.any(Number) });
    expect(db.db.prepare('SELECT sequence,event_id FROM events').all()).toEqual([{ sequence: result.sequence, event_id: 'evt-1' }]);
    expect(db.db.prepare('SELECT event_sequence,project_id,job_type,idempotency_key FROM processing_jobs').all()).toEqual([{ event_sequence: result.sequence, project_id: 'proj-1', job_type: 'classify', idempotency_key: 'classify:src-1:evt-1' }]);
  });
  it('rolls the event back if inserting its job fails', () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    db.db.exec("CREATE TRIGGER reject_classify BEFORE INSERT ON processing_jobs BEGIN SELECT RAISE(FAIL, 'injected job failure'); END;");
    expect(() => db.ingest(event())).toThrow(/injected job failure/);
    expect(db.db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 0 });
    expect(db.db.prepare('SELECT count(*) AS n FROM processing_jobs').get()).toEqual({ n: 0 });
  });
  it('deduplicates deliveries from two connections', async () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    const other = new SqliteStorage(join(dir, 'storage.sqlite')); stores.push(other);
    const results = await Promise.all([Promise.resolve().then(() => db.ingest(event())), Promise.resolve().then(() => other.ingest(event()))]);
    expect(results.map(r => r.disposition).sort()).toEqual(['accepted', 'duplicate']);
    expect(db.db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1 });
    expect(db.db.prepare('SELECT count(*) AS n FROM processing_jobs').get()).toEqual({ n: 1 });
  });
  it('replays an already applied migration without duplicating schema records', () => {
    const db = storage();
    db.db.exec('PRAGMA user_version=1');
    const reopened = new SqliteStorage(join(dir, 'storage.sqlite')); stores.push(reopened);
    expect(reopened.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(reopened.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }]);
  });
  it('returns a clean SQLite busy error while a writer lock is held', () => {
    const db = new SqliteStorage(join(dir, 'storage.sqlite'), { timeout: 1 }); stores.push(db); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    const other = new SqliteStorage(join(dir, 'storage.sqlite'), { timeout: 1 }); stores.push(other);
    other.db.exec('BEGIN IMMEDIATE');
    try { expect(() => db.ingest(event())).toThrow(/locked|busy/i); }
    finally { if (other.db.isTransaction) other.db.exec('ROLLBACK'); }
    expect(db.db.isTransaction).toBe(false);
    expect(db.ingest(event()).disposition).toBe('accepted');
  });
  it('treats identical retries as duplicates and rejects changed payloads', () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' });
    const first = db.ingest(event());
    expect(db.ingest(event())).toEqual({ disposition: 'duplicate', sequence: first.sequence });
    expect(() => db.ingest(event({ metadata: { turn: 2 } }))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(db.db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1 });
    expect(db.db.prepare('SELECT count(*) AS n FROM processing_jobs').get()).toEqual({ n: 1 });
  });
  it('retains registration and ingested data after reopening the database', () => {
    const db = storage(); db.register({ sourceInstanceId: 'src-1', projectId: 'proj-1' }); const accepted = db.ingest(event());
    db.close(); stores = [];
    const reopened = storage();
    expect(reopened.lookup('src-1', 'evt-1')).toMatchObject({ sequence: accepted.sequence, project_id: 'proj-1', event_id: 'evt-1' });
    expect(reopened.ingest(event())).toEqual({ disposition: 'duplicate', sequence: accepted.sequence });
  });
});
