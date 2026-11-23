import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";

import type { QaConfig } from "./config.js";
import {
  authStatePath,
  loginCommand,
  type RunEnvironment,
  resolveEnvironment,
} from "./environments.js";
import { QaError } from "./errors.js";
import { type Fixtures, loadFixtures, redactValues } from "./fixtures.js";
import {
  type GenerateOptions,
  generateFromSpec,
  generateFromTrace,
  readTraceFile,
} from "./generate.js";
import { gitChangedFiles } from "./git.js";
import { type Plan, planCases } from "./plan.js";
import { applyRepair, findReplacement, REPAIRABLE_CODES, type RepairChange } from "./repair.js";
import {
  type CaseResult,
  type CreateSubstrate,
  defaultCreateSubstrate,
  type RunOutcome,
  replaySteps,
  runCases,
} from "./runner.js";
import {
  caseContentSha,
  caseMatchesSuite,
  type LoadedCase,
  loadCases,
  loadSuites,
  type QaCase,
  type QaLocator,
  type QaSuite,
  readCaseFile,
  writeCaseFile,
} from "./spec.js";
import {
  type CaseFilter,
  type CaseResultRow,
  type CaseRow,
  QaStore,
  type RunReport,
} from "./store.js";
import type { QaSubstrate } from "./types.js";

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
  /** Named environment to run against, by name. */
  env?: string;
  /** Profile (account role) within `env`. */
  as?: string;
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

export type GenerateReport = {
  case_id: string;
  path: string;
  spec: QaCase;
  warnings: string[];
  next: string[];
};

export type RepairReport = {
  case_id: string;
  repaired: boolean;
  reason: string;
  run_id?: string;
  changes: RepairChange[];
  confirmation?: {
    run_id: string;
    status: CaseResult["status"];
    fail_code?: string;
    fail_reason?: string;
  };
  next: string[];
};

export type QaServiceDeps = {
  now?: () => Date;
  /** Overrides substrate creation; tests inject a fake. */
  createSubstrate?: CreateSubstrate;
  /** Overrides where environment sessions are read from (`PORTOLAN_HOME`). */
  home?: string;
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
  private readonly createSubstrate?: CreateSubstrate;
  private readonly home: string | undefined;

  constructor(
    readonly config: QaConfig,
    deps: QaServiceDeps = {},
  ) {
    this.store = new QaStore(config.database);
    this.fixtures = loadFixtures(config.fixtures);
    this.now = deps.now ?? (() => new Date());
    this.createSubstrate = deps.createSubstrate;
    this.home = deps.home;
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

  /**
   * Normalize an agent-authored spec or a recorded trace into a draft case and
   * write it. The write path is `qa_case_write` semantics: always draft, one
   * file per case, promoted only by verify.
   */
  generate(
    input: { fromSpec?: unknown; fromTracePath?: string },
    options: GenerateOptions = {},
  ): GenerateReport {
    let generated: { spec: QaCase; warnings: string[] };

    if (input.fromTracePath !== undefined) {
      const tracePath = isAbsolute(input.fromTracePath)
        ? input.fromTracePath
        : join(this.config.root, input.fromTracePath);
      const trace = readTraceFile(tracePath);
      generated = generateFromTrace(trace, {
        ...options,
        ...(options.redact === undefined ? { redact: this.config.redact } : {}),
      });
    } else if (input.fromSpec !== undefined) {
      generated = generateFromSpec(input.fromSpec, options);
    } else {
      throw new QaError("invalid_request", "generate needs from_spec or from_trace");
    }

    this.sync();
    if (this.store.getCase(generated.spec.id) !== undefined) {
      throw new QaError(
        "invalid_request",
        `case "${generated.spec.id}" already exists; pass a new id`,
        {
          existing: generated.spec.id,
        },
      );
    }

    const written = this.caseWrite(generated.spec);

    return {
      case_id: written.spec.id,
      path: written.path,
      spec: written.spec,
      warnings: generated.warnings,
      next: [`qa verify ${written.spec.id}`, `read the case: ${written.path}`],
    };
  }

  /**
   * Attempt locator recovery for a case that failed on `not_found`,
   * `stale_ref`, or `not_interactive`: replay to the failure, re-resolve the
   * target on a fresh capture, rewrite the locator, write the case as draft,
   * record a drift event, and run the repaired case once to confirm.
   */
  async repair(input: {
    caseId: string;
    fromRun?: string;
    env?: string;
    as?: string;
  }): Promise<RepairReport> {
    this.sync();
    const target0 = this.target(input);
    const found = this.store.getCase(input.caseId);
    if (found === undefined) throw new QaError("not_found", `no case "${input.caseId}"`);
    const spec = found.spec;

    const failure = this.findFailure(input.caseId, input.fromRun);
    if (failure === undefined) {
      return {
        case_id: input.caseId,
        repaired: false,
        reason: "no failed run recorded for this case; run it first, then repair from its evidence",
        changes: [],
        next: [`qa run --case ${input.caseId}`],
      };
    }

    const { runId, row } = failure;
    if (!REPAIRABLE_CODES.has(row.fail_code ?? "")) {
      return {
        case_id: input.caseId,
        repaired: false,
        reason: `fail_code "${row.fail_code ?? "none"}" is not a locator failure (${[...REPAIRABLE_CODES].join(", ")})`,
        run_id: runId,
        changes: [],
        next: [`qa result ${runId} --case ${input.caseId}`, "fix the app or the expectation"],
      };
    }

    const target = failureTarget(spec, row);
    if (target === undefined) {
      return {
        case_id: input.caseId,
        repaired: false,
        reason: "the failed step has no locator to recover",
        run_id: runId,
        changes: [],
        next: [`qa result ${runId} --case ${input.caseId}`],
      };
    }

    const create = this.createSubstrate ?? defaultCreateSubstrate;
    let substrate: QaSubstrate | undefined;

    try {
      substrate = await create({
        baseUrl: target0.baseUrl,
        headless: this.config.headless,
        ...(this.config.chrome !== undefined ? { executablePath: this.config.chrome } : {}),
        timeoutMs: this.config.timeoutMs,
        ...(target0.environment !== undefined
          ? {
              storageState: target0.environment.storageState,
              readOnly: !target0.environment.writes,
            }
          : {}),
      });

      try {
        await replaySteps({
          spec,
          uptoStep: target.phase === "check" ? spec.steps.length : (row.fail_step ?? 0),
          substrate,
          baseUrl: target0.baseUrl,
          ...(target0.environment !== undefined ? { environment: target0.environment } : {}),
          timeoutMs: this.config.timeoutMs,
          fixtures: this.fixtures,
          env: process.env,
          redact: this.config.redact,
          loadMap: (site, version) => this.loadMap(site, version),
        });
      } catch (error) {
        const reason = error instanceof QaError ? `${error.code}: ${error.message}` : String(error);
        return {
          case_id: input.caseId,
          repaired: false,
          reason: `the case no longer replays to the failure point (${reason}); repair by hand`,
          run_id: runId,
          changes: [],
          next: [`qa result ${runId} --case ${input.caseId}`],
        };
      }

      const view = await substrate.view();
      const outcome = findReplacement(view.snapshot.nodes, target.locator);

      if (outcome.status !== "replaced") {
        return {
          case_id: input.caseId,
          repaired: false,
          reason: outcome.reason,
          run_id: runId,
          changes: [],
          next:
            outcome.status === "resolves"
              ? [`qa run --case ${input.caseId}`, "the failure was transient, not drift"]
              : [`qa result ${runId} --case ${input.caseId}`, "update the locator by hand"],
        };
      }

      const repaired = applyRepair(spec, target.locator, outcome.locator);
      this.caseWrite(repaired.spec);
      this.store.recordDrift(
        input.caseId,
        "selector",
        { from: target.locator, to: outcome.locator, reason: outcome.reason },
        runId,
      );

      const confirmation = await this.run(
        { ids: [input.caseId] },
        {
          allowUnverified: true,
          trigger: "repair",
          ...(input.env !== undefined ? { env: input.env } : {}),
          ...(input.as !== undefined ? { as: input.as } : {}),
        },
      );
      const result = confirmation.results[0];
      const confirmed = result?.status === "pass";

      return {
        case_id: input.caseId,
        repaired: true,
        reason: outcome.reason,
        run_id: runId,
        changes: repaired.changes,
        confirmation:
          result === undefined
            ? undefined
            : {
                run_id: confirmation.run_id,
                status: result.status,
                ...(result.fail_code !== undefined ? { fail_code: result.fail_code } : {}),
                ...(result.fail_reason !== undefined ? { fail_reason: result.fail_reason } : {}),
              },
        next: confirmed
          ? [`qa verify ${input.caseId}`]
          : [
              `qa result ${confirmation.run_id} --case ${input.caseId}`,
              "the rewrite did not fix the run; repair again or by hand",
            ],
      };
    } finally {
      await substrate?.close?.();
    }
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
    const target = this.target(options);
    const resolved = this.select(selection);
    const run = this.store.startRun({
      base_url: target.baseUrl,
      trigger: options.trigger ?? "manual",
      ...(this.commit() !== undefined ? { commit: this.commit() } : {}),
      ...(this.branch() !== undefined ? { branch: this.branch() } : {}),
      selection,
      config: {
        repeat: options.repeat ?? this.config.repeat,
        ...(target.environment !== undefined
          ? { environment: `${target.environment.name}/${target.environment.profile}` }
          : {}),
      },
    });

    let outcome: RunOutcome;

    try {
      outcome = await runCases({
        baseUrl: target.baseUrl,
        ...(target.environment !== undefined ? { environment: target.environment } : {}),
        cases: resolved.cases,
        repeat: options.repeat ?? this.config.repeat,
        headless: this.config.headless,
        ...(this.config.chrome !== undefined ? { executablePath: this.config.chrome } : {}),
        ...(this.createSubstrate !== undefined ? { createSubstrate: this.createSubstrate } : {}),
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

    const redacted = outcome.results.map((result) =>
      this.withSessionHint(this.redactResult(result), target.environment),
    );

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
    options: { repeat?: number; env?: string; as?: string } = {},
  ): Promise<VerifyReport[]> {
    const target = this.target(options);
    const resolved = this.select(selection);
    const repeat = options.repeat ?? this.config.verifyRepeat;
    const reports: VerifyReport[] = [];

    for (const spec of resolved.cases) {
      const results: CaseResult[] = [];

      for (let attempt = 0; attempt < repeat; attempt += 1) {
        const outcome = await runCases({
          baseUrl: target.baseUrl,
          ...(target.environment !== undefined ? { environment: target.environment } : {}),
          cases: [spec],
          repeat: 1,
          headless: this.config.headless,
          ...(this.config.chrome !== undefined ? { executablePath: this.config.chrome } : {}),
          ...(this.createSubstrate !== undefined ? { createSubstrate: this.createSubstrate } : {}),
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

  /** Environments an agent may name, with session presence but no paths or values. */
  environments(): {
    name: string;
    base_url: string;
    writes: boolean;
    profiles: { name: string; session: boolean }[];
  }[] {
    return Object.values(this.config.environments).map((environment) => ({
      name: environment.name,
      base_url: environment.baseUrl,
      writes: environment.writes,
      profiles: environment.profiles.map((profile) => ({
        name: profile,
        session: existsSync(authStatePath(this.config.root, environment.name, profile, this.home)),
      })),
    }));
  }

  /** The base URL and, for an environment run, the session it runs as. */
  private target(input: { env?: string | undefined; as?: string | undefined }): {
    baseUrl: string;
    environment?: RunEnvironment;
  } {
    const environment = resolveEnvironment(this.config.environments, input, {
      root: this.config.root,
      ...(this.home !== undefined ? { home: this.home } : {}),
    });
    return environment === undefined
      ? { baseUrl: this.config.baseUrl }
      : { baseUrl: environment.baseUrl, environment };
  }

  /**
   * A stale session fails like any other broken page, so name the likely cause
   * on a failure in an environment run. The agent gets a command for a person
   * to run, never a credential.
   */
  private withSessionHint(result: CaseResult, environment: RunEnvironment | undefined): CaseResult {
    if (environment === undefined || (result.status !== "fail" && result.status !== "error")) {
      return result;
    }
    const hint = `if the page is a sign-in screen the session expired; a person runs: ${loginCommand(environment.name, environment.profile)}`;
    return { ...result, next: [...(result.next ?? []), hint] };
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

  /** The newest failed run of this case, or the one the caller named. */
  private findFailure(
    caseId: string,
    fromRun?: string,
  ): { runId: string; row: CaseResultRow } | undefined {
    if (fromRun !== undefined) {
      const report = this.store.getRun(fromRun);
      const row = report?.cases.find((item) => item.case_id === caseId);
      if (report === undefined || row === undefined) {
        throw new QaError("not_found", `run "${fromRun}" has no result for case "${caseId}"`);
      }
      return { runId: fromRun, row };
    }

    for (const run of this.store.listRuns(25)) {
      const row = this.store
        .getRun(run.id)
        ?.cases.find(
          (item) => item.case_id === caseId && (item.status === "fail" || item.status === "error"),
        );
      if (row !== undefined) return { runId: run.id, row };
    }

    return undefined;
  }

  private suite(name: string): QaSuite {
    const suite = loadSuites(this.config.suites).find((item) => item.spec.name === name);
    if (suite === undefined) {
      throw new QaError(
        "not_found",
        `no suite "${name}": a suite is its own file at ${join(this.config.suites, `${name}.json`)}; use --tag ${name} to select cases by tag instead`,
      );
    }
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

/**
 * The locator a failed run broke on, read from the current spec.
 *
 * `fail_step` indexes `steps`; a check failure is recorded as
 * `steps.length + check_index`. Setup steps index into `setup` with the same
 * counter, so when both phases could own the index we prefer whichever
 * actually holds a target.
 */
function failureTarget(
  spec: QaCase,
  row: CaseResultRow,
): { locator: QaLocator; phase: "setup" | "step" | "check" } | undefined {
  const failStep = row.fail_step;
  if (failStep === null || failStep < 0) return undefined;

  const step = spec.steps[failStep];
  if (step !== undefined && "target" in step && step.target !== undefined) {
    return { locator: step.target, phase: "step" };
  }

  const setupStep = spec.setup[failStep];
  if (setupStep !== undefined && "target" in setupStep && setupStep.target !== undefined) {
    return { locator: setupStep.target, phase: "setup" };
  }

  const check = spec.expect[failStep - spec.steps.length];
  if (check === undefined) return undefined;
  if ("visible" in check) return { locator: check.visible, phase: "check" };
  if ("absent" in check) return { locator: check.absent, phase: "check" };
  if ("value" in check) return { locator: check.value.target, phase: "check" };
  return undefined;
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
