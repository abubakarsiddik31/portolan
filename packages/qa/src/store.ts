import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { QaError } from "./errors.js";
import {
  type CaseStatus,
  caseContentSha,
  governedMap,
  type LoadedCase,
  type LoadedSuite,
  parseCase,
  type QaCase,
  sha256,
} from "./spec.js";

export type CaseFilter = {
  suite?: string;
  tag?: string;
  status?: string;
};

export type CaseRow = {
  id: string;
  suite: string;
  title: string;
  status: string;
  effect: string;
  tags: string[];
  touches: string[];
  routes: string[];
  file_path: string;
  spec_sha: string;
  verified_at: string | null;
  verified_sha: string | null;
  verify_runs: number;
  revision: number;
  updated_at: string;
};

export type SyncReport = {
  cases: number;
  suites: number;
  added: string[];
  changed: string[];
  orphaned: string[];
};

export type StartRun = {
  commit?: string;
  branch?: string;
  base_url: string;
  trigger: string;
  selection?: unknown;
  config?: unknown;
};

export type RunRow = {
  id: string;
  commit_sha: string | null;
  branch: string | null;
  base_url: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
};

export type CaseResultRow = {
  run_id: string;
  case_id: string;
  status: string;
  attempt: number;
  duration_ms: number | null;
  fail_code: string | null;
  fail_reason: string | null;
  fail_step: number | null;
  expected_json: string | null;
  actual_json: string | null;
  evidence_dir: string | null;
};

export type EvidenceRow = {
  id: string;
  run_id: string;
  case_id: string;
  kind: string;
  path: string;
  sha256: string;
  bytes: number;
  created_at: string;
};

export type RunReport = {
  run: RunRow;
  cases: CaseResultRow[];
  evidence: EvidenceRow[];
  summary: { pass: number; fail: number; skip: number; error: number };
};

export type FlakeRow = {
  case_id: string;
  runs: number;
  failures: number;
  last_failure_at: string | null;
  last_pass_at: string | null;
  consecutive_failures: number;
  quarantine: number;
};

const SCHEMA_VERSION = 1;

/**
 * The local QA store.
 *
 * Specs stay in files; this database indexes them and is the system of record
 * for history (runs, results, evidence, flakes, drift, coverage). Deleting it
 * loses history but never loses a case.
 */
export class QaStore {
  private readonly db: InstanceType<typeof Database>;
  private readonly path: string;

  constructor(path = ":memory:") {
    this.path = path;

    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  location(): string {
    return this.path;
  }

  schemaVersion(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    return row === undefined ? 0 : Number(row.value);
  }

  integrity(): { ok: boolean; specDrift: string[] } {
    const check = this.db.pragma("integrity_check", { simple: true });
    const specDrift: string[] = [];

    for (const row of this.db
      .prepare("SELECT id, spec_sha, spec_json FROM cases WHERE status != 'orphaned'")
      .all() as Array<{ id: string; spec_sha: string; spec_json: string }>) {
      if (sha256(row.spec_json) !== row.spec_sha) specDrift.push(row.id);
    }

    return { ok: check === "ok" && specDrift.length === 0, specDrift };
  }

  /** Files → index. Missing case files are marked orphaned, never deleted. */
  syncSpecs(input: { cases: LoadedCase[]; suites: LoadedSuite[] }): SyncReport {
    const now = new Date().toISOString();
    const added: string[] = [];
    const changed: string[] = [];
    const seen = new Set<string>();

    const run = this.db.transaction(() => {
      for (const suite of input.suites) {
        this.db
          .prepare(
            `INSERT INTO suites (name, title, spec_json, spec_sha, file_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               title = excluded.title,
               spec_json = excluded.spec_json,
               spec_sha = excluded.spec_sha,
               file_path = excluded.file_path,
               updated_at = excluded.updated_at`,
          )
          .run(suite.spec.name, suite.spec.title, suite.text, suite.sha, suite.path, now, now);
      }

      for (const item of input.cases) {
        seen.add(item.spec.id);
        const existing = this.rawCase(item.spec.id);
        const status = fileStatus(item.spec);

        if (existing === undefined) {
          this.insertCase(item, status, now, 1);
          added.push(item.spec.id);
          continue;
        }

        if (existing.spec_sha === item.sha) {
          this.db
            .prepare("UPDATE cases SET file_path = ?, updated_at = ? WHERE id = ?")
            .run(item.path, now, item.spec.id);
          continue;
        }

        const revision = existing.revision + 1;
        const nextStatus = status === "disabled" ? "disabled" : "draft";
        this.db
          .prepare(
            `UPDATE cases SET
               suite = ?, title = ?, status = ?, effect = ?, tags_json = ?,
               touches_json = ?, routes_json = ?, source_json = ?, spec_json = ?,
               spec_sha = ?, file_path = ?, verified_at = NULL, verified_sha = NULL, verify_runs = 0,
               map_site = ?, map_version = ?, updated_at = ?, revision = ?
             WHERE id = ?`,
          )
          .run(
            item.spec.suite,
            item.spec.title,
            nextStatus,
            item.spec.effect,
            JSON.stringify(item.spec.tags),
            JSON.stringify(item.spec.touches),
            JSON.stringify(item.spec.routes),
            item.spec.source === undefined ? null : JSON.stringify(item.spec.source),
            JSON.stringify(item.spec),
            item.sha,
            item.path,
            item.spec.map?.site ?? null,
            governedMap(item.spec)?.version ?? null,
            now,
            revision,
            item.spec.id,
          );
        changed.push(item.spec.id);
      }

      const orphaned: string[] = [];
      for (const row of this.db
        .prepare("SELECT id FROM cases WHERE status != 'orphaned'")
        .all() as Array<{ id: string }>) {
        if (seen.has(row.id)) continue;
        this.db
          .prepare("UPDATE cases SET status = 'orphaned', updated_at = ? WHERE id = ?")
          .run(now, row.id);
        orphaned.push(row.id);
      }

      return orphaned;
    });

    const orphaned = run();
    return { cases: input.cases.length, suites: input.suites.length, added, changed, orphaned };
  }

  putCase(item: LoadedCase, options: { note?: string; status?: CaseStatus } = {}): CaseRow {
    const now = new Date().toISOString();
    const status = options.status ?? "draft";

    const run = this.db.transaction(() => {
      const existing = this.rawCase(item.spec.id);
      if (existing !== undefined) {
        this.db
          .prepare(
            `UPDATE cases SET
               suite = ?, title = ?, status = ?, effect = ?, tags_json = ?,
               touches_json = ?, routes_json = ?, source_json = ?, spec_json = ?,
               spec_sha = ?, file_path = ?, verified_at = ?, verified_sha = ?, verify_runs = ?,
               map_site = ?, map_version = ?, updated_at = ?, revision = ?
             WHERE id = ?`,
          )
          .run(
            item.spec.suite,
            item.spec.title,
            status,
            item.spec.effect,
            JSON.stringify(item.spec.tags),
            JSON.stringify(item.spec.touches),
            JSON.stringify(item.spec.routes),
            item.spec.source === undefined ? null : JSON.stringify(item.spec.source),
            JSON.stringify(item.spec),
            item.sha,
            item.path,
            status === "verified" ? (item.spec.verifiedAt ?? now) : null,
            status === "verified" ? caseContentSha(item.spec) : null,
            status === "verified" ? (item.spec.verifyRuns ?? 0) : 0,
            item.spec.map?.site ?? null,
            governedMap(item.spec)?.version ?? null,
            now,
            (existing?.revision ?? 0) + 1,
            item.spec.id,
          );
        return this.rawCase(item.spec.id);
      }

      this.insertCase(item, status, now, 1);
      return this.rawCase(item.spec.id);
    });

    const row = run();
    if (row === undefined) throw new QaError("store_error", `failed to index ${item.spec.id}`);
    return toCaseRow(row);
  }

  listCases(filter: CaseFilter = {}): CaseRow[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, f.quarantine
         FROM cases c
         LEFT JOIN flakes f ON f.case_id = c.id
         WHERE (? IS NULL OR c.suite = ?)
           AND (? IS NULL OR c.status = ?)
         ORDER BY c.id`,
      )
      .all(
        filter.suite ?? null,
        filter.suite ?? null,
        filter.status ?? null,
        filter.status ?? null,
      ) as RawCaseRow[];

    const filtered =
      filter.tag === undefined
        ? rows
        : rows.filter((row) =>
            (JSON.parse(row.tags_json) as string[]).includes(filter.tag as string),
          );

    return filtered.map((row) => toCaseRow(row));
  }

  getCase(id: string): { spec: QaCase; row: CaseRow } | undefined {
    const row = this.rawCase(id);
    if (row === undefined) return undefined;
    // Older rows stored the raw file text, which omits schema defaults
    // (`setup`, `expect`, `tags`). Parse on read so the in-memory spec always
    // has every array the runner and repair paths iterate.
    return { spec: parseCase(JSON.parse(row.spec_json)), row: toCaseRow(row) };
  }

  startRun(input: StartRun): RunRow {
    const id = randomUUID();
    const startedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO runs (id, commit_sha, branch, base_url, trigger, status, selection_json, config_json, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        id,
        input.commit ?? null,
        input.branch ?? null,
        input.base_url,
        input.trigger,
        JSON.stringify(input.selection ?? {}),
        JSON.stringify(input.config ?? {}),
        startedAt,
      );

    return {
      id,
      commit_sha: input.commit ?? null,
      branch: input.branch ?? null,
      base_url: input.base_url,
      trigger: input.trigger,
      status: "running",
      started_at: startedAt,
      finished_at: null,
    };
  }

  finishRun(id: string, status: string): void {
    this.db
      .prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  recordCase(runId: string, result: Record<string, unknown>): void {
    const caseId = String(result.case_id ?? "");
    this.db
      .prepare(
        `INSERT OR REPLACE INTO run_cases
           (run_id, case_id, status, attempt, duration_ms, fail_code, fail_reason,
            fail_step, expected_json, actual_json, evidence_dir)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        caseId,
        String(result.status ?? "error"),
        Number(result.attempt ?? 1),
        result.duration_ms === undefined ? null : Number(result.duration_ms),
        result.fail_code === undefined ? null : String(result.fail_code),
        result.fail_reason === undefined ? null : String(result.fail_reason),
        result.fail_step === undefined ? null : Number(result.fail_step),
        result.expected === undefined ? null : JSON.stringify(result.expected),
        result.actual === undefined ? null : JSON.stringify(result.actual),
        result.evidence_dir === undefined ? null : String(result.evidence_dir),
      );
  }

  addEvidence(
    runId: string,
    caseId: string,
    kind: string,
    path: string,
    bytes: number,
    digest: string,
  ): EvidenceRow {
    const row: EvidenceRow = {
      id: randomUUID(),
      run_id: runId,
      case_id: caseId,
      kind,
      path,
      sha256: digest,
      bytes,
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO evidence (id, run_id, case_id, kind, path, sha256, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.run_id,
        row.case_id,
        row.kind,
        row.path,
        row.sha256,
        row.bytes,
        row.created_at,
      );

    return row;
  }

  listRuns(limit = 20): RunRow[] {
    return this.db
      .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as RunRow[];
  }

  getRun(id: string): RunReport | undefined {
    const run = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (run === undefined) return undefined;

    const cases = this.db
      .prepare("SELECT * FROM run_cases WHERE run_id = ? ORDER BY case_id, attempt")
      .all(id) as CaseResultRow[];

    const evidence = this.db
      .prepare("SELECT * FROM evidence WHERE run_id = ? ORDER BY case_id, kind")
      .all(id) as EvidenceRow[];

    const summary = { pass: 0, fail: 0, skip: 0, error: 0 };
    for (const item of cases) {
      if (item.status === "pass") summary.pass += 1;
      else if (item.status === "fail") summary.fail += 1;
      else if (item.status === "skip") summary.skip += 1;
      else summary.error += 1;
    }

    return { run, cases, evidence, summary };
  }

  recordFlake(caseId: string, passed: boolean, quarantineAfter = 3): FlakeRow {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM flakes WHERE case_id = ?").get(caseId) as
      | FlakeRow
      | undefined;

    const runs = (existing?.runs ?? 0) + 1;
    const failures = (existing?.failures ?? 0) + (passed ? 0 : 1);
    const consecutive = passed ? 0 : (existing?.consecutive_failures ?? 0) + 1;
    const quarantine = consecutive >= quarantineAfter ? 1 : (existing?.quarantine ?? 0);

    this.db
      .prepare(
        `INSERT INTO flakes (case_id, runs, failures, last_failure_at, last_pass_at, consecutive_failures, quarantine)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(case_id) DO UPDATE SET
           runs = excluded.runs,
           failures = excluded.failures,
           last_failure_at = excluded.last_failure_at,
           last_pass_at = excluded.last_pass_at,
           consecutive_failures = excluded.consecutive_failures,
           quarantine = excluded.quarantine`,
      )
      .run(
        caseId,
        runs,
        failures,
        passed ? (existing?.last_failure_at ?? null) : now,
        passed ? now : (existing?.last_pass_at ?? null),
        consecutive,
        quarantine,
      );

    const row = this.db.prepare("SELECT * FROM flakes WHERE case_id = ?").get(caseId) as FlakeRow;
    return row;
  }

  recordDrift(
    caseId: string,
    kind: string,
    detail: unknown,
    runId?: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO drift_events (id, case_id, run_id, kind, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), caseId, runId ?? null, kind, JSON.stringify(detail), now);
  }

  putCoverage(
    snapshotId: string,
    entries: Array<{ kind: string; key: string; covered_by: string[] }>,
  ): void {
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      for (const entry of entries) {
        this.db
          .prepare(
            `INSERT INTO coverage (snapshot_id, kind, key, covered_by_json, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(snapshot_id, kind, key) DO UPDATE SET
               covered_by_json = excluded.covered_by_json,
               updated_at = excluded.updated_at`,
          )
          .run(snapshotId, entry.kind, entry.key, JSON.stringify(entry.covered_by), now);
      }
    });
    run();
  }

  coverage(snapshotId: string): Array<{ kind: string; key: string; covered_by: string[] }> {
    return (
      this.db
        .prepare("SELECT kind, key, covered_by_json FROM coverage WHERE snapshot_id = ?")
        .all(snapshotId) as Array<{ kind: string; key: string; covered_by_json: string }>
    ).map((row) => ({
      kind: row.kind,
      key: row.key,
      covered_by: JSON.parse(row.covered_by_json) as string[],
    }));
  }

  setStatus(caseId: string, status: string): void {
    this.db
      .prepare("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), caseId);
  }

  private rawCase(id: string): RawCaseRow | undefined {
    return this.db.prepare("SELECT *, 0 AS quarantine FROM cases WHERE id = ?").get(id) as
      | RawCaseRow
      | undefined;
  }

  private insertCase(item: LoadedCase, status: CaseStatus, now: string, revision: number): void {
    this.db
      .prepare(
        `INSERT INTO cases
           (id, suite, title, status, effect, tags_json, touches_json, routes_json,
            source_json, spec_json, spec_sha, file_path, verified_at, verified_sha, verify_runs,
            map_site, map_version, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.spec.id,
        item.spec.suite,
        item.spec.title,
        status,
        item.spec.effect,
        JSON.stringify(item.spec.tags),
        JSON.stringify(item.spec.touches),
        JSON.stringify(item.spec.routes),
        item.spec.source === undefined ? null : JSON.stringify(item.spec.source),
        JSON.stringify(item.spec),
        item.sha,
        item.path,
        status === "verified" ? (item.spec.verifiedAt ?? now) : null,
        status === "verified" ? caseContentSha(item.spec) : null,
        status === "verified" ? (item.spec.verifyRuns ?? 0) : 0,
        item.spec.map?.site ?? null,
        governedMap(item.spec)?.version ?? null,
        now,
        now,
        revision,
      );
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS suites (
        name TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        spec_sha TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        suite TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        effect TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        touches_json TEXT NOT NULL DEFAULT '[]',
        routes_json TEXT NOT NULL DEFAULT '[]',
        source_json TEXT,
        spec_json TEXT NOT NULL,
        spec_sha TEXT NOT NULL,
        file_path TEXT NOT NULL,
        verified_at TEXT,
        verified_sha TEXT,
        verify_runs INTEGER NOT NULL DEFAULT 0,
        map_site TEXT,
        map_version INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS cases_suite ON cases (suite);
      CREATE INDEX IF NOT EXISTS cases_status ON cases (status);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        commit_sha TEXT,
        branch TEXT,
        base_url TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        selection_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS runs_started ON runs (started_at);

      CREATE TABLE IF NOT EXISTS run_cases (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER,
        fail_code TEXT,
        fail_reason TEXT,
        fail_step INTEGER,
        expected_json TEXT,
        actual_json TEXT,
        evidence_dir TEXT,
        PRIMARY KEY (run_id, case_id, attempt)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evidence_run ON evidence (run_id, case_id);

      CREATE TABLE IF NOT EXISTS drift_events (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flakes (
        case_id TEXT PRIMARY KEY,
        runs INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        last_failure_at TEXT,
        last_pass_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        quarantine INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS coverage (
        snapshot_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        covered_by_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, kind, key)
      );
    `);

    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  }
}

type RawCaseRow = {
  id: string;
  suite: string;
  title: string;
  status: string;
  effect: string;
  tags_json: string;
  touches_json: string;
  routes_json: string;
  source_json: string | null;
  spec_json: string;
  spec_sha: string;
  file_path: string;
  verified_at: string | null;
  verified_sha: string | null;
  verify_runs: number;
  map_site: string | null;
  map_version: number | null;
  created_at: string;
  updated_at: string;
  revision: number;
  quarantine: number;
};

function fileStatus(spec: QaCase): CaseStatus {
  return spec.status === "disabled" ? "disabled" : "draft";
}

function toCaseRow(row: RawCaseRow): CaseRow {
  return {
    id: row.id,
    suite: row.suite,
    title: row.title,
    status: row.quarantine === 1 && row.status !== "orphaned" ? "quarantined" : row.status,
    effect: row.effect,
    tags: JSON.parse(row.tags_json) as string[],
    touches: JSON.parse(row.touches_json) as string[],
    routes: JSON.parse(row.routes_json) as string[],
    file_path: row.file_path,
    spec_sha: row.spec_sha,
    verified_at: row.verified_at,
    verified_sha: row.verified_sha,
    verify_runs: row.verify_runs,
    revision: row.revision,
    updated_at: row.updated_at,
  };
}

export { caseContentSha };
