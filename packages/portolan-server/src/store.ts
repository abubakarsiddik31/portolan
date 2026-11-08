import { randomUUID } from "node:crypto";

import type { AuditRecord, CreateSessionRequest, SessionRecord } from "@portolan/protocol";
import Database from "better-sqlite3";
import type { OpHealthRecord } from "./health.js";

type SessionRow = {
  sid: string;
  site: string | null;
  profile: string | null;
  map_version: number | null;
  state: string | null;
  created_at: string;
  last_used_at: string;
  closed_at: string | null;
};

/**
 * Sessions live in SQLite so a restart does not lose them.
 *
 * better-sqlite3 is synchronous, and every operation here is a single indexed
 * row, so the server can keep handling concurrent requests. The store owns the
 * database handle; the server never closes it.
 */
export class SessionStore {
  private readonly db: InstanceType<typeof Database>;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        site TEXT,
        profile TEXT,
        map_version INTEGER,
        state TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_open ON sessions (closed_at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        sid TEXT NOT NULL,
        site TEXT NOT NULL,
        op TEXT NOT NULL,
        effect TEXT NOT NULL,
        tier TEXT,
        params TEXT NOT NULL,
        idempotency_key TEXT,
        before_state TEXT,
        after_state TEXT,
        outcome TEXT NOT NULL,
        requests TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_sid ON audit_log (sid, created_at);

      CREATE TABLE IF NOT EXISTS op_health (
        site TEXT NOT NULL,
        op TEXT NOT NULL,
        map_version INTEGER,
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        message TEXT,
        ms INTEGER,
        PRIMARY KEY (site, op)
      );
    `);
  }

  create(input: CreateSessionRequest = {}): SessionRecord {
    const now = new Date().toISOString();
    const sid = randomUUID();

    this.db
      .prepare(
        `INSERT INTO sessions (sid, site, profile, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sid, input.site ?? null, input.profile ?? null, now, now);

    const record: SessionRecord = { sid, created_at: now, last_used_at: now };
    if (input.site !== undefined) record.site = input.site;
    if (input.profile !== undefined) record.profile = input.profile;
    return record;
  }

  get(sid: string): SessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid) as
      | SessionRow
      | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  /** Pin a session to a map version. Returns false when it is unknown or closed. */
  pin(sid: string, mapVersion: number): boolean {
    const result = this.db
      .prepare("UPDATE sessions SET map_version = ? WHERE sid = ? AND closed_at IS NULL")
      .run(mapVersion, sid);
    return result.changes > 0;
  }

  /** Mark a session as used. Returns false when it is unknown or closed. */
  touch(sid: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE sessions SET last_used_at = ? WHERE sid = ? AND closed_at IS NULL")
      .run(now, sid);
    return result.changes > 0;
  }

  /** Close a session. Returns false when it is unknown or already closed. */
  close(sid: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE sessions SET closed_at = ? WHERE sid = ? AND closed_at IS NULL")
      .run(now, sid);
    return result.changes > 0;
  }

  recordAudit(record: AuditRecord): void {
    this.db
      .prepare(
        `INSERT INTO audit_log
          (id, sid, site, op, effect, tier, params, idempotency_key,
           before_state, after_state, outcome, requests, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sid,
        record.site,
        record.op,
        record.effect,
        record.tier ?? null,
        JSON.stringify(record.params),
        record.idempotency_key ?? null,
        record.before_state ?? null,
        record.after_state ?? null,
        record.outcome,
        record.requests === undefined ? null : JSON.stringify(record.requests),
        record.created_at,
      );
  }

  listAudit(sid: string): AuditRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_log WHERE sid = ? ORDER BY created_at, id")
      .all(sid) as AuditRow[];

    return rows.map(toAuditRecord);
  }

  recordOpHealth(record: OpHealthRecord): void {
    this.db
      .prepare(
        `INSERT INTO op_health (site, op, map_version, status, checked_at, message, ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site, op) DO UPDATE SET
           map_version = excluded.map_version,
           status = excluded.status,
           checked_at = excluded.checked_at,
           message = excluded.message,
           ms = excluded.ms`,
      )
      .run(
        record.site,
        record.op,
        record.map_version ?? null,
        record.status,
        record.checked_at,
        record.message ?? null,
        record.ms ?? null,
      );
  }

  listOpHealth(site: string): OpHealthRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM op_health WHERE site = ? ORDER BY op")
      .all(site) as OpHealthRow[];

    return rows.map(toOpHealth);
  }

  listOpen(): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE closed_at IS NULL ORDER BY created_at")
      .all() as SessionRow[];
    return rows.map(toRecord);
  }

  closeDatabase(): void {
    this.db.close();
  }
}

function toRecord(row: SessionRow): SessionRecord {
  const record: SessionRecord = {
    sid: row.sid,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };

  if (row.site !== null) record.site = row.site;
  if (row.profile !== null) record.profile = row.profile;
  if (row.map_version !== null) record.map_version = row.map_version;
  if (row.state !== null) record.state = row.state;
  if (row.closed_at !== null) record.closed_at = row.closed_at;

  return record;
}

type AuditRow = {
  id: string;
  sid: string;
  site: string;
  op: string;
  effect: string;
  tier: string | null;
  params: string;
  idempotency_key: string | null;
  before_state: string | null;
  after_state: string | null;
  outcome: string;
  requests: string | null;
  created_at: string;
};

type OpHealthRow = {
  site: string;
  op: string;
  map_version: number | null;
  status: string;
  checked_at: string;
  message: string | null;
  ms: number | null;
};

function toOpHealth(row: OpHealthRow): OpHealthRecord {
  const record: OpHealthRecord = {
    site: row.site,
    op: row.op,
    status: row.status as OpHealthRecord["status"],
    checked_at: row.checked_at,
  };

  if (row.map_version !== null) record.map_version = row.map_version;
  if (row.message !== null) record.message = row.message;
  if (row.ms !== null) record.ms = row.ms;

  return record;
}

function toAuditRecord(row: AuditRow): AuditRecord {
  const record: AuditRecord = {
    id: row.id,
    sid: row.sid,
    site: row.site,
    op: row.op,
    effect: row.effect as AuditRecord["effect"],
    params: JSON.parse(row.params) as Record<string, unknown>,
    outcome: row.outcome as AuditRecord["outcome"],
    created_at: row.created_at,
  };

  if (row.tier !== null) record.tier = row.tier as NonNullable<AuditRecord["tier"]>;
  if (row.idempotency_key !== null) record.idempotency_key = row.idempotency_key;
  if (row.before_state !== null) record.before_state = row.before_state;
  if (row.after_state !== null) record.after_state = row.after_state;
  if (row.requests !== null) {
    record.requests = JSON.parse(row.requests) as AuditRecord["requests"];
  }

  return record;
}
