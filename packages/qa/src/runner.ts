import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SiteMap } from "@abubakarsiddiik/protocol";
import { matchingNodes } from "@abubakarsiddiik/runtime";
import {
  EngineError,
  findChrome,
  PlaywrightEngine,
  rankAffordances,
  renderAffordances,
  Substrate,
} from "@abubakarsiddiik/substrate";

import { evaluateCheck } from "./checks.js";
import type { EvidenceMode } from "./config.js";
import { QaError, type QaErrorCode } from "./errors.js";
import { type Fixtures, redactText, redactValues, resolveValues } from "./fixtures.js";
import type { QaCase, QaLocator, QaStep } from "./spec.js";
import type { QaSubstrate, QaView } from "./types.js";

export type RunTrigger = "manual" | "changed" | "verify" | "ci" | "mcp" | "plan";

export type StepEvent = {
  at: string;
  phase: "setup" | "step" | "check";
  index: number;
  kind: string;
  ok: boolean;
  code?: string;
  ms?: number;
  detail?: unknown;
};

export type CaseResult = {
  case_id: string;
  status: "pass" | "fail" | "skip" | "error";
  attempt: number;
  duration_ms: number;
  fail_code?: QaErrorCode;
  fail_reason?: string;
  fail_step?: number;
  expected?: unknown;
  actual?: unknown;
  evidence_dir?: string;
  events?: StepEvent[];
  next?: string[];
};

export type RunSummary = {
  pass: number;
  fail: number;
  skip: number;
  error: number;
};

export type CreateSubstrate = (input: {
  baseUrl: string;
  headless: boolean;
  executablePath?: string;
  timeoutMs: number;
}) => Promise<QaSubstrate> | QaSubstrate;

export type RunInput = {
  baseUrl: string;
  cases: QaCase[];
  repeat?: number;
  headless?: boolean;
  executablePath?: string;
  timeoutMs?: number;
  evidence?: EvidenceMode;
  evidenceRoot?: string;
  allowUnverified?: boolean;
  trusted?: string[];
  screenshot?: boolean;
  fixtures?: Fixtures;
  env?: NodeJS.ProcessEnv;
  redact?: string[];
  loadMap?: (site: string, version?: number) => SiteMap | undefined;
  createSubstrate?: CreateSubstrate;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  runId?: string;
};

export type RunOutcome = {
  results: CaseResult[];
  summary: RunSummary;
};

/**
 * Run cases deterministically: one fresh substrate per attempt, typed steps,
 * typed assertions, and evidence for a failure.
 *
 * There is no model in this path. The caller's agent authored the case; the
 * runner replays it and reports exactly what happened.
 */
export async function runCases(input: RunInput): Promise<RunOutcome> {
  const repeat = Math.max(1, input.repeat ?? 1);
  const evidenceMode = input.evidence ?? "failures";
  const results: CaseResult[] = [];

  for (const spec of input.cases) {
    if (spec.status === "disabled") {
      results.push(skip(spec, "case is disabled"));
      continue;
    }

    if (new Set(input.trusted ?? []).has(spec.id) === false && input.allowUnverified !== true) {
      results.push(skip(spec, "case is not verified", [`qa verify ${spec.id}`]));
      continue;
    }

    const attempts: CaseResult[] = [];
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      attempts.push(await runAttempt(spec, attempt, input, evidenceMode));
    }

    const first = attempts[0] ?? skip(spec, "no attempt ran");
    const distinct = new Set(attempts.map((item) => item.status));

    if (repeat > 1 && distinct.size > 1) {
      results.push({
        ...first,
        status: "fail",
        fail_code: "flaky",
        fail_reason: `flaky across ${repeat} attempts: ${attempts
          .map((item) => item.status)
          .join(", ")}`,
        next: [`qa verify ${spec.id}`],
      });
      continue;
    }

    results.push(first);
  }

  return { results, summary: summarize(results) };
}

async function runAttempt(
  spec: QaCase,
  attempt: number,
  input: RunInput,
  evidenceMode: EvidenceMode,
): Promise<CaseResult> {
  const started = (input.now ?? (() => new Date()))().getTime();
  const events: StepEvent[] = [];
  const now = input.now ?? (() => new Date());
  const redact = input.redact ?? [];

  let substrate: QaSubstrate | undefined;

  try {
    const create = input.createSubstrate ?? defaultCreateSubstrate;
    substrate = await create({
      baseUrl: input.baseUrl,
      headless: input.headless ?? true,
      ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
      timeoutMs: input.timeoutMs ?? 15_000,
    });

    const context = {
      fixtures: input.fixtures ?? {},
      env: input.env ?? process.env,
      redact,
    };

    for (const [offset, raw] of spec.setup.entries()) {
      const step = resolveStep(raw, context) as QaStep;
      const stepStarted = now().getTime();
      try {
        await executeStep(step, substrate, {
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs ?? 15_000,
          sleep: input.sleep ?? sleep,
          now,
          map:
            spec.map === undefined ? undefined : input.loadMap?.(spec.map.site, spec.map.version),
        });
        events.push({
          at: now().toISOString(),
          phase: "setup",
          index: offset,
          kind: stepKind(step),
          ok: true,
          ms: now().getTime() - stepStarted,
        });
      } catch (error) {
        const typed = asQaError(error);
        events.push({
          at: now().toISOString(),
          phase: "setup",
          index: offset,
          kind: stepKind(step),
          ok: false,
          code: typed.code,
          ms: now().getTime() - stepStarted,
          detail: typed.details,
        });
        throw new StepFailure(typed, offset);
      }
    }

    for (const [offset, raw] of spec.steps.entries()) {
      const step = resolveStep(raw, context) as QaStep;
      const stepStarted = now().getTime();
      try {
        await executeStep(step, substrate, {
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs ?? 15_000,
          sleep: input.sleep ?? sleep,
          now,
          map:
            spec.map === undefined ? undefined : input.loadMap?.(spec.map.site, spec.map.version),
        });
        events.push({
          at: now().toISOString(),
          phase: "step",
          index: offset,
          kind: stepKind(step),
          ok: true,
          ms: now().getTime() - stepStarted,
        });
      } catch (error) {
        const typed = asQaError(error);
        events.push({
          at: now().toISOString(),
          phase: "step",
          index: offset,
          kind: stepKind(step),
          ok: false,
          code: typed.code,
          ms: now().getTime() - stepStarted,
          detail: typed.details,
        });
        throw new StepFailure(typed, offset);
      }
    }

    const view = substrate.state() ?? (await substrate.view());
    const map =
      spec.map === undefined ? undefined : input.loadMap?.(spec.map.site, spec.map.version);

    for (const [offset, check] of spec.expect.entries()) {
      const outcome = await evaluateCheck({ check, view, substrate, ...(map ? { map } : {}) });
      if (!outcome.ok) {
        return failResult(spec, attempt, started, now, {
          status: "fail",
          code: "assertion_failed",
          reason: outcome.message,
          step: spec.steps.length + offset,
          expected: outcome.expected,
          actual: outcome.actual,
          events,
          view,
          substrate,
          input,
          evidenceMode,
        });
      }
    }

    const passed = passResult(spec, attempt, started, now, events);

    if (evidenceMode === "all") {
      const dir = await writeEvidence({
        spec,
        result: passed,
        view,
        substrate,
        input,
        evidenceMode,
      });
      if (dir !== undefined) passed.evidence_dir = dir;
    }

    return passed;
  } catch (error) {
    const typed = error instanceof StepFailure ? error.error : asQaError(error);
    const failStep = error instanceof StepFailure ? error.index : undefined;
    const view = substrate?.state();

    return failResult(spec, attempt, started, now, {
      status: typed.code === "harness_error" ? "error" : "fail",
      code: typed.code,
      reason: typed.message,
      ...(failStep !== undefined ? { step: failStep } : {}),
      ...(typed.details !== undefined ? { actual: typed.details } : {}),
      events,
      ...(view !== undefined ? { view } : {}),
      ...(substrate !== undefined ? { substrate } : {}),
      input,
      evidenceMode,
    });
  } finally {
    await substrate?.close?.();
  }
}

async function executeStep(
  step: QaStep,
  substrate: QaSubstrate,
  options: {
    baseUrl: string;
    timeoutMs: number;
    sleep: (ms: number) => Promise<void>;
    now: () => Date;
    map?: SiteMap;
  },
): Promise<void> {
  if ("goto" in step) {
    const url = new URL(step.goto, options.baseUrl).toString();
    try {
      await substrate.goto(url);
    } catch (error) {
      if (error instanceof EngineError) {
        throw new QaError("navigation", `could not open ${url}: ${error.message}`, {
          code: error.code,
        });
      }
      throw error;
    }
    return;
  }

  if ("await" in step) {
    const timeout = step.timeout_ms ?? options.timeoutMs;
    const deadline = options.now().getTime() + timeout;

    while (options.now().getTime() <= deadline) {
      const view = substrate.state() ?? (await substrate.view());

      if (step.await === "url") {
        if (
          step.pattern !== undefined &&
          new RegExp(step.pattern).test(pathname(view.snapshot.url))
        ) {
          return;
        }
      } else if (step.contains !== undefined) {
        const page = await substrate.read();
        if (page.text.includes(step.contains)) return;
      }

      await options.sleep(100);
    }

    throw new QaError("timeout", `await ${step.await} timed out after ${timeout}ms`);
  }

  if ("op" in step) {
    if (options.map === undefined) {
      throw new QaError("precondition_failed", `op "${step.op}" needs a loaded map`);
    }

    const op = options.map.ops.find((candidate) => candidate.name === step.op);
    if (op === undefined) {
      throw new QaError("precondition_failed", `map has no op "${step.op}"`);
    }

    const params = (step.params ?? {}) as Record<string, unknown>;
    const failures: string[] = [];

    for (const impl of op.impls) {
      if (impl.tier === "ui") {
        const { runUiOp } = await import("@abubakarsiddiik/runtime");
        const result = await runUiOp({
          map: options.map,
          op,
          params,
          substrate: substrate as unknown as Substrate,
        });
        if (result.ok) return;
        failures.push(`${impl.tier}: ${result.message}`);
        continue;
      }

      if (impl.tier === "url") {
        const { runUrlOp } = await import("@abubakarsiddiik/runtime");
        const result = await runUrlOp({
          map: options.map,
          op,
          params,
          substrate: substrate as unknown as Substrate,
          baseUrl: options.baseUrl,
        });
        if (result.ok) return;
        failures.push(`${impl.tier}: ${result.message}`);
        continue;
      }

      if (impl.tier === "http") {
        const { runHttpOp } = await import("@abubakarsiddiik/runtime");
        const result = await runHttpOp({
          map: options.map,
          op,
          params,
          substrate: substrate as unknown as Substrate,
          baseUrl: options.baseUrl,
        });
        if (result.ok) return;
        failures.push(`${impl.tier}: ${result.message}`);
      }
    }

    throw new QaError("op_failed", `op "${step.op}" failed`, { failures });
  }

  const locator = step.target ?? { role: "textbox" };
  let view = substrate.state() ?? (await substrate.view());
  let result = await actOn(locator, step, substrate, view);

  if (!result.ok && (result.code === "stale_ref" || result.code === "not_interactive")) {
    view = await substrate.view();
    result = await actOn(locator, step, substrate, view);
  }

  if (!result.ok) {
    if (result.code === "stale_ref") {
      throw new QaError("stale_ref", "target went stale after a retry", {
        locator,
      });
    }
    if (result.code === "not_interactive") {
      throw new QaError("not_interactive", result.reason ?? "target is covered", {
        ...(result.blocker_role !== undefined ? { blocker_role: result.blocker_role } : {}),
        ...(result.blocker_name !== undefined ? { blocker_name: result.blocker_name } : {}),
      });
    }
    throw new QaError("invalid_request", result.message);
  }

  if (step.do === "fill") {
    await verifyFill(locator, step.value, substrate);
  }
}

async function verifyFill(
  locator: QaLocator,
  expected: string,
  substrate: QaSubstrate,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const view = substrate.state() ?? (await substrate.view());
    const node = matchingNodes(view.snapshot.nodes, locator)[0];
    const ref = node === undefined ? undefined : view.refs.byNode.get(node.nodeId)?.ref;
    if (ref === undefined) throw new QaError("stale_ref", "fill target went stale");

    const current = (await substrate.read(ref)).text;
    if (current === expected) return;

    if (attempt === 0) {
      await substrate.act({ ref, do: "click" });
      const again = await substrate.act({ ref, do: "fill", value: expected });
      if (!again.ok) break;
    }
  }

  throw new QaError("value_lost", "fill did not stick", { expected });
}

async function actOn(locator: QaLocator, step: QaStep, substrate: QaSubstrate, view: QaView) {
  const matches = matchingNodes(view.snapshot.nodes, locator);
  const node = matches.find((candidate) => matchesContext(candidate, locator, view)) ?? matches[0];
  if (node === undefined) {
    throw new QaError("not_found", "locator did not resolve", { locator });
  }

  const ref = view.refs.byNode.get(node.nodeId)?.ref;
  if (ref === undefined) {
    throw new QaError("stale_ref", "node has no ref", { locator });
  }

  const request = {
    ref,
    ...stepAction(step),
  };

  return substrate.act(request);
}

function matchesContext(node: { nodeId: string }, locator: QaLocator, view: QaView): boolean {
  if (locator.ctx === undefined) return true;
  const ranked = rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 1000 }).affordances;
  const entry = ranked.find(
    (item) => item.ref !== undefined && item.ref === view.refs.byNode.get(node.nodeId)?.ref,
  );
  return entry?.ctx?.toLowerCase().includes(locator.ctx.toLowerCase()) ?? false;
}

function stepAction(step: QaStep): {
  do: "click" | "check" | "uncheck" | "fill" | "select" | "press";
  value?: string;
  key?: string;
} {
  if ("do" in step) {
    if (step.do === "fill" || step.do === "select") {
      return { do: step.do, value: step.value };
    }
    if (step.do === "press") return { do: "press", key: step.key };
    return { do: step.do };
  }

  return { do: "click" };
}

function resolveStep(
  step: QaStep,
  context: { fixtures: Fixtures; env: NodeJS.ProcessEnv; redact: string[] },
): unknown {
  const copy = JSON.parse(JSON.stringify(step)) as Record<string, unknown>;
  if ("params" in copy) copy.params = resolveValues(copy.params, context);
  if ("value" in copy) copy.value = resolveValues(copy.value, context);
  if ("goto" in copy) copy.goto = resolveValues(copy.goto, context);
  if ("contains" in copy) copy.contains = resolveValues(copy.contains, context);
  if ("pattern" in copy) copy.pattern = resolveValues(copy.pattern, context);
  return copy;
}

function stepKind(step: QaStep): string {
  if ("goto" in step) return "goto";
  if ("await" in step) return `await:${step.await}`;
  if ("op" in step) return `op:${step.op}`;
  return `do:${step.do}`;
}

function passResult(
  spec: QaCase,
  attempt: number,
  started: number,
  now: () => Date,
  events: StepEvent[],
): CaseResult {
  return {
    case_id: spec.id,
    status: "pass",
    attempt,
    duration_ms: now().getTime() - started,
    events,
  };
}

function failResult(
  spec: QaCase,
  attempt: number,
  started: number,
  now: () => Date,
  input: {
    status: "fail" | "error";
    code: QaErrorCode;
    reason: string;
    step?: number;
    expected?: unknown;
    actual?: unknown;
    events: StepEvent[];
    view?: QaView;
    substrate?: QaSubstrate;
    input: RunInput;
    evidenceMode: EvidenceMode;
  },
): CaseResult {
  const result: CaseResult = {
    case_id: spec.id,
    status: input.status,
    attempt,
    duration_ms: now().getTime() - started,
    fail_code: input.code,
    fail_reason: input.reason,
    ...(input.step !== undefined ? { fail_step: input.step } : {}),
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {}),
    events: input.events,
    next: nextFor(input.code, spec.id),
  };

  if (
    input.input.evidenceRoot !== undefined &&
    input.evidenceMode !== "none" &&
    input.view !== undefined
  ) {
    const dir = writeEvidenceSync({
      spec,
      result,
      view: input.view,
      substrate: input.substrate,
      input: input.input,
    });
    if (dir !== undefined) result.evidence_dir = dir;
  }

  return result;
}

function skip(
  spec: QaCase,
  reason: string,
  next?: string[],
  code: QaErrorCode = "unverified",
): CaseResult {
  return {
    case_id: spec.id,
    status: "skip",
    attempt: 1,
    duration_ms: 0,
    fail_code: code,
    fail_reason: reason,
    ...(next !== undefined ? { next } : {}),
  };
}

function summarize(results: CaseResult[]): RunSummary {
  const summary: RunSummary = { pass: 0, fail: 0, skip: 0, error: 0 };
  for (const result of results) summary[result.status] += 1;
  return summary;
}

function nextFor(code: QaErrorCode, id: string): string[] {
  switch (code) {
    case "assertion_failed":
      return [`qa result --case ${id}`, "inspect the evidence, then fix the app or the case"];
    case "not_found":
      return [`qa repair ${id}`, "the target moved or was renamed"];
    case "stale_ref":
    case "not_interactive":
      return [`qa repair ${id}`, "re-snapshot and re-resolve the target"];
    case "unverified":
      return [`qa verify ${id}`];
    case "harness_error":
      return ["qa doctor", "check the base URL and the browser binary"];
    default:
      return [`qa result --case ${id}`];
  }
}

function asQaError(error: unknown): QaError {
  if (error instanceof QaError) return error;
  if (error instanceof EngineError) {
    return new QaError(
      error.code === "navigation_failed" ? "navigation" : "not_interactive",
      error.message,
      { code: error.code },
    );
  }
  return new QaError("harness_error", error instanceof Error ? error.message : String(error));
}

class StepFailure extends Error {
  readonly error: QaError;
  readonly index: number;

  constructor(error: QaError, index: number) {
    super(error.message);
    this.name = "StepFailure";
    this.error = error;
    this.index = index;
  }
}

function defaultCreateSubstrate(input: {
  headless: boolean;
  executablePath?: string;
  timeoutMs: number;
}): Promise<QaSubstrate> {
  const executablePath = input.executablePath ?? findChrome();
  if (executablePath === undefined) {
    throw new QaError("harness_error", "no Chrome or Chromium found; set CHROME_PATH");
  }

  return PlaywrightEngine.launch({
    executablePath,
    headless: input.headless,
    timeoutMs: input.timeoutMs,
  }).then((engine) => new Substrate(engine));
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeEvidenceSync(input: {
  spec: QaCase;
  result: CaseResult;
  view: QaView;
  substrate?: QaSubstrate;
  input: RunInput;
}): string | undefined {
  const root = input.input.evidenceRoot;
  if (root === undefined) return undefined;

  const runId = input.input.runId ?? "manual";
  const caseDir = input.spec.id.replace(/[^a-zA-Z0-9._-]+/g, "__");
  const dir = join(root, runId, caseDir, `attempt-${input.result.attempt}`);

  try {
    mkdirSync(dir, { recursive: true });
    const redact = input.input.redact ?? [];
    const rendered = renderAffordances(
      rankAffordances(input.view.snapshot.nodes, { refs: input.view.refs, limit: 500 }).affordances,
    );
    writeFileSync(join(dir, "view.txt"), `${redactText(rendered.text, redact)}\n`, "utf8");
    writeFileSync(
      join(dir, "result.json"),
      `${JSON.stringify(redactValues(input.result, redact), null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "events.jsonl"),
      `${(input.result.events ?? []).map((event) => JSON.stringify(redactValues(event, redact))).join("\n")}\n`,
      "utf8",
    );
    return dir;
  } catch {
    return undefined;
  }
}

async function writeEvidence(input: {
  spec: QaCase;
  result: CaseResult;
  view: QaView;
  substrate: QaSubstrate;
  input: RunInput;
  evidenceMode: EvidenceMode;
}): Promise<string | undefined> {
  const root = input.input.evidenceRoot;
  if (root === undefined) return undefined;

  const runId = input.input.runId ?? "manual";
  const caseDir = input.spec.id.replace(/[^a-zA-Z0-9._-]+/g, "__");
  const dir = join(root, runId, caseDir, `attempt-${input.result.attempt}`);

  try {
    mkdirSync(dir, { recursive: true });
    const redact = input.input.redact ?? [];
    const rendered = renderAffordances(
      rankAffordances(input.view.snapshot.nodes, { refs: input.view.refs, limit: 500 }).affordances,
    );
    writeFileSync(join(dir, "view.txt"), `${redactText(rendered.text, redact)}\n`, "utf8");
    writeFileSync(
      join(dir, "result.json"),
      `${JSON.stringify(redactValues(input.result, redact), null, 2)}\n`,
      "utf8",
    );

    if (input.input.screenshot === true) {
      const screenshot = await input.substrate.screenshot?.();
      if (screenshot !== undefined) writeFileSync(join(dir, "page.png"), screenshot);
    }

    return dir;
  } catch {
    return undefined;
  }
}
