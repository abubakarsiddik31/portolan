import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMap, type SiteMap } from "@portolan/protocol";

import type { QaConfig } from "./config.js";
import { QaError } from "./errors.js";
import { type Fixtures, loadFixtures, redactValues } from "./fixtures.js";
import { gitChangedFiles } from "./git.js";
import { type Plan, planCases } from "./plan.js";
import { type CaseResult, type RunOutcome, runCases } from "./runner.js";
import {
  caseContentSha,
  caseMatchesSuite,
  type LoadedCase,
  loadCases,
  loadSuites,
  type QaCase,
  type QaSuite,
  readCaseFile,
  writeCaseFile,
} from "./spec.js";
import { type CaseFilter, type CaseRow, QaStore, type RunReport } from "./store.js";

export type Selection = {
  suite?: string;
  ids?: string[];
  tags?: string[];
  changed?: boolean;
  includeQuarantined?: boolean;
  max?: number;
};

export type ResolvedSelection = {
  cases: QaCase[];
  plan?: Plan;
  trusted: string[];
  unverified: string[];
};

export type RunOptions = {
  repeat?: number;
  allowUnverified?: boolean;
  evidence?: "failures" | "all" | "none";
  trigger?: string;
};

export type RunResult = {
  run_id: string;
  summary: RunOutcome["summary"];
  results: CaseResult[];
};

export type VerifyReport = {
  case_id: string;
  verified: boolean;
  runs: number;
  results: CaseResult[];
  reason?: string;
};

export type QaServiceDeps = {
  now?: () => Date;
};

/**
 * The shared engine behind the CLI and the MCP server.
 *
 * It owns the spec/DB boundary: every read syncs first, every write updates
 * the file and the index together.
 */
export class QaService {
  readonly store: QaStore;
  private readonly fixtures: Fixtures;
  private readonly now: () => Date;

  constructor(
    readonly config: QaConfig,
    deps: QaServiceDeps = {},
  ) {
    this.store = new QaStore(config.database);
    this.fixtures = loadFixtures(config.fixtures);
    this.now = deps.now ?? (() => new Date());
    this.sync();
  }

  close(): void {
    this.store.close();
  }

  sync(): ReturnType<QaStore["syncSpecs"]> {
    return this.store.syncSpecs({
      cases: loadCases(this.config.cases),
      suites: loadSuites(this.config.suites),
    });
  }

  list(filter: CaseFilter = {}): CaseRow[] {
    this.sync();
    return this.store.listCases(filter);
  }

  caseRead(id: string): { spec: QaCase; row: CaseRow; path: string } {
    this.sync();
    const found = this.store.getCase(id);
    if (found === undefined) throw new QaError("not_found", `no case "${id}"`);
    return { ...found, path: found.row.file_path };
  }

  caseWrite(spec: QaCase): { spec: QaCase; row: CaseRow; path: string } {
    const path = join(this.config.cases, `${spec.id}.json`);
    const written = writeCaseFile(path, spec, { status: "draft", now: this.now() });
    const loaded = readCaseFile(path);
    const row = this.store.putCase(loaded, { note: "qa_case_write", status: "draft" });
    return { spec: written, row, path };
  }

  select(selection: Selection = {}): ResolvedSelection {
    this.sync();
    const all = loadCases(this.config.cases);
    const rows = new Map(this.store.listCases().map((row) => [row.id, row]));
    const excluded = new Set<string>();

    for (const row of rows.values()) {
      if (row.status === "orphaned" || row.status === "disabled") excluded.add(row.id);
      if (row.status === "quarantined" && selection.includeQuarantined !== true) {
        excluded.add(row.id);
      }
    }

    let chosen: LoadedCase[] = all.filter((item) => !excluded.has(item.spec.id));
    let plan: Plan | undefined;

    if (selection.changed === true) {
      plan = planCases({
        cases: [...rows.values()].map((row) => ({
          id: row.id,
          status: row.status,
          tags: row.tags,
          touches: row.touches,
        })),
        changedFiles: gitChangedFiles(this.config.root, this.config.baseRef),
        max: selection.max ?? this.config.maxCases,
        includeQuarantined: selection.includeQuarantined ?? false,
      });
      const selected = new Set(plan.selected);
      chosen = chosen.filter((item) => selected.has(item.spec.id));
    } else if (selection.suite !== undefined) {
      const suite = this.suite(selection.suite);
      chosen = chosen.filter((item) => caseMatchesSuite(item.spec, suite));
    } else if (selection.ids !== undefined && selection.ids.length > 0) {
      const ids = new Set(selection.ids);
      chosen = chosen.filter((item) => ids.has(item.spec.id));
    } else if (selection.tags !== undefined && selection.tags.length > 0) {
      const tags = new Set(selection.tags);
      chosen = chosen.filter((item) => item.spec.tags.some((tag) => tags.has(tag)));
    }

    if (selection.max !== undefined) chosen = chosen.slice(0, selection.max);

    const trusted = chosen
      .filter((item) => {
        const row = rows.get(item.spec.id);
        return row?.status === "verified" && row.verified_sha === caseContentSha(item.spec);
      })
      .map((item) => item.spec.id);
    const trustedSet = new Set(trusted);
    const unverified = chosen
      .filter((item) => !trustedSet.has(item.spec.id))
      .map((item) => item.spec.id);

    return {
      cases: chosen.map((item) => item.spec),
      ...(plan !== undefined ? { plan } : {}),
      trusted,
      unverified,
    };
  }

  async run(selection: Selection = {}, options: RunOptions = {}): Promise<RunResult> {
    const resolved = this.select(selection);
    const run = this.store.startRun({
      base_url: this.config.baseUrl,
      trigger: options.trigger ?? "manual",
      ...(this.commit() !== undefined ? { commit: this.commit() } : {}),
      ...(this.branch() !== undefined ? { branch: this.branch() } : {}),
      selection,
      config: { repeat: options.repeat ?? this.config.repeat },
    });

    let outcome: RunOutcome;

    try {
      outcome = await runCases({
        baseUrl: this.config.baseUrl,
        cases: resolved.cases,
        repeat: options.repeat ?? this.config.repeat,
        headless: this.config.headless,
        ...(this.config.chrome !== undefined ? { executablePath: this.config.chrome } : {}),
        timeoutMs: this.config.timeoutMs,
        evidence: options.evidence ?? this.config.evidence,
        evidenceRoot: this.config.runs,
        runId: run.id,
        allowUnverified: options.allowUnverified ?? this.config.allowUnverified,
        trusted: resolved.trusted,
        screenshot: this.config.screenshot,
        fixtures: this.fixtures,
        env: process.env,
        redact: this.config.redact,
        loadMap: (site, version) => this.loadMap(site, version),
      });
    } catch (error) {
      this.store.finishRun(run.id, "error");
      throw error;
    }

    const redacted = outcome.results.map((result) => this.redactResult(result));

    for (const result of redacted) {
      this.store.recordCase(run.id, result);
      if (result.status === "pass" || result.status === "fail") {
        this.store.recordFlake(result.case_id, result.status === "pass");
      }
      if (result.evidence_dir !== undefined) {
        this.store.addEvidence(run.id, result.case_id, "evidence", result.evidence_dir, 0, "");
      }
    }

    const failed = outcome.summary.fail > 0 || outcome.summary.error > 0;
    this.store.finishRun(run.id, failed ? "failed" : "passed");

    return { run_id: run.id, summary: outcome.summary, results: redacted };
  }

  async verify(
    selection: Selection = {},
    options: { repeat?: number } = {},
  ): Promise<VerifyReport[]> {
    const resolved = this.select(selection);
    const repeat = options.repeat ?? this.config.verifyRepeat;
    const reports: VerifyReport[] = [];

    for (const spec of resolved.cases) {
      const results: CaseResult[] = [];

      for (let attempt = 0; attempt < repeat; attempt += 1) {
        const outcome = await runCases({
          baseUrl: this.config.baseUrl,
          cases: [spec],
          repeat: 1,
          headless: this.config.headless,
          ...(this.config.chrome !== undefined ? { executablePath: this.config.chrome } : {}),
          timeoutMs: this.config.timeoutMs,
          evidence: "none",
          allowUnverified: true,
          trusted: [spec.id],
          screenshot: false,
          fixtures: this.fixtures,
          env: process.env,
          redact: this.config.redact,
          loadMap: (site, version) => this.loadMap(site, version),
        });
        results.push(...outcome.results);
      }

      const failed = results.find((result) => result.status !== "pass");
      const report: VerifyReport = {
        case_id: spec.id,
        verified: failed === undefined,
        runs: results.length,
        results,
        ...(failed !== undefined
          ? { reason: `${failed.fail_code ?? failed.status}: ${failed.fail_reason ?? ""}` }
          : {}),
      };

      if (report.verified) {
        const path = join(this.config.cases, `${spec.id}.json`);
        writeCaseFile(path, spec, {
          status: "verified",
          verifiedRuns: repeat,
          now: this.now(),
        });
        const loaded = readCaseFile(path);
        this.store.putCase(loaded, { note: "verified", status: "verified" });
      } else {
        this.store.setStatus(spec.id, "broken");
      }

      reports.push(report);
    }

    return reports;
  }

  getRun(id: string): RunReport | undefined {
    return this.store.getRun(id);
  }

  coverage(): Array<{ kind: string; key: string; covered_by: string[] }> {
    const cases = loadCases(this.config.cases);
    const routes = new Map<string, string[]>();

    for (const item of cases) {
      for (const route of item.spec.routes) {
        routes.set(route, [...(routes.get(route) ?? []), item.spec.id]);
      }
    }

    const entries = [...routes.entries()].map(([key, covered_by]) => ({
      kind: "route",
      key,
      covered_by,
    }));

    this.store.putCoverage("current", entries);
    return entries;
  }

  loadMap(site: string, requested?: number): SiteMap | undefined {
    const dir = join(this.config.maps, site);
    if (!existsSync(dir)) return undefined;

    let version = requested;

    if (version === undefined) {
      const versions = readdirSync(dir)
        .map((name) => /^v(\d+)\.json$/.exec(name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]))
        .sort((a, b) => b - a);
      version = versions[0];
    }

    if (version === undefined) return undefined;

    try {
      return parseMap(readFileSync(join(dir, `v${version}.json`), "utf8"));
    } catch {
      return undefined;
    }
  }

  private redactResult(result: CaseResult): CaseResult {
    const safe = redactValues(
      {
        ...result,
        expected: cap(result.expected),
        actual: cap(result.actual),
      },
      this.config.redact,
    ) as CaseResult;
    return safe;
  }

  private suite(name: string): QaSuite {
    const suite = loadSuites(this.config.suites).find((item) => item.spec.name === name);
    if (suite === undefined) throw new QaError("not_found", `no suite "${name}"`);
    return suite.spec;
  }

  private commit(): string | undefined {
    return gitValue(this.config.root, ["rev-parse", "HEAD"]);
  }

  private branch(): string | undefined {
    return gitValue(this.config.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  }
}

function cap(value: unknown, limit = 2000): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text === undefined || text.length <= limit) return value;
  return `${text.slice(0, limit)}…[truncated]`;
}

function gitValue(root: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}
