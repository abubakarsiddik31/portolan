import type { WriteLedger, WriteRecord } from "@abubakarsiddiik/runtime";
import type Database from "better-sqlite3";

type WriteRow = {
  key: string;
  site: string;
  op: string;
  status: WriteRecord["status"];
  result: string | null;
  updated_at: string;
};

/**
 * The write ledger, in the same SQLite file as sessions and the audit log.
 *
 * A key survives a restart, so a retry after a crash replays the stored result
 * or refuses, instead of performing the write twice. A record left `pending`
 * by a dead process is settled to `unknown` at startup: it may have reached
 * the site, so the next call must not retry it.
 */
export class SqliteWriteLedger implements WriteLedger {
  constructor(private readonly db: InstanceType<typeof Database>) {}

  get(key: string): WriteRecord | undefined {
    const row = this.db.prepare("SELECT * FROM write_ledger WHERE key = ?").get(key) as
      | WriteRow
      | undefined;
    if (row === undefined) return undefined;

    const record: WriteRecord = {
      key: row.key,
      site: row.site,
      op: row.op,
      status: row.status,
      updatedAt: row.updated_at,
    };

    if (row.result !== null) record.result = JSON.parse(row.result) as unknown;
    return record;
  }

  put(record: WriteRecord): void {
    this.db
      .prepare(
        `INSERT INTO write_ledger (key, site, op, status, result, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           site = excluded.site,
           op = excluded.op,
           status = excluded.status,
           result = excluded.result,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.key,
        record.site,
        record.op,
        record.status,
        record.result === undefined ? null : JSON.stringify(record.result),
        record.updatedAt,
      );
  }
}
