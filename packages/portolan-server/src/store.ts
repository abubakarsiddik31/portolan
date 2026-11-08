import { randomUUID } from "node:crypto";

import type { CreateSessionRequest, SessionRecord } from "@portolan/protocol";
import Database from "better-sqlite3";

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
