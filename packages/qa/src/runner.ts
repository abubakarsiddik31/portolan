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

import { type CheckOutcome, evaluateCheck } from "./checks.js";
import type { EvidenceMode } from "./config.js";
import type { RunEnvironment } from "./environments.js";
import { QaError, type QaErrorCode } from "./errors.js";
import {
  caseNames,
  type Fixtures,
  type ResolveContext,
  redactText,
  redactValues,
  resolveValues,
} from "./fixtures.js";
import { governedMap, type QaCase, type QaCheck, type QaLocator, type QaStep } from "./spec.js";
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
  /** `known_failure` is a case marked expect_failure failing as recorded; `fixed` is one now passing. */
  status: "pass" | "fail" | "skip" | "error" | "known_failure" | "fixed";
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
  /** Present only when a case marked expect_failure produced one. */
  known_failure?: number;
  fixed?: number;
};

export type CreateSubstrate = (input: {
  baseUrl: string;
  headless: boolean;
  executablePath?: string;
  timeoutMs: number;
  /** Signed-in session for an environment run. */
  storageState?: string;
  /** Refuse every request that could change server state. */
  readOnly?: boolean;
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
  /**
   * Run as a named environment and profile: its saved session, its origin,
   * and its write policy. Absent means the single `baseUrl` behaviour.
   */
  environment?: RunEnvironment;
  /** Internal: secret values resolved during one attempt, scrubbed on output. */
  secretValues?: Set<string>;
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

    if (input.environment !== undefined && !input.environment.writes && spec.effect !== "read") {
      results.push(
        skip(
          spec,
          `environment "${input.environment.name}" is read-only and this case has effect "${spec.effect}"`,
          ['an operator can set "writes": true on the environment in .portolan/config.json'],
          "precondition_failed",
        ),
      );
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
  outer: RunInput,
  evidenceMode: EvidenceMode,
): Promise<CaseResult> {
  const secrets = new Set<string>();
  const result = await attemptCore(
    spec,
    attempt,
    { ...outer, secretValues: secrets },
    evidenceMode,
  );
  return scrubResult(result, secrets);
}

/**
 * Scrub resolved secrets from the free-text fields of a result.
 *
 * Structural fields (`case_id`, `status`, `fail_code`, an event's `kind`) are
 * left alone: a short secret such as `admin` must not rewrite a case id or a
 * status the store and `verify` read back.
 */
export function scrubResult(result: CaseResult, secrets: Set<string>): CaseResult {
  if (secrets.size === 0) return result;
  const scrub = (value: unknown): unknown => redactValues(value, [], secrets);

  return {
    ...result,
    ...(result.fail_reason !== undefined
      ? { fail_reason: redactText(result.fail_reason, [], secrets) }
      : {}),
    ...(result.expected !== undefined ? { expected: scrub(result.expected) } : {}),
    ...(result.actual !== undefined ? { actual: scrub(result.actual) } : {}),
    ...(result.events !== undefined
      ? { events: result.events.map((event) => scrubEvent(event, secrets)) }
      : {}),
  };
}

function scrubEvent(event: StepEvent, secrets: Set<string>): StepEvent {
  return event.detail === undefined
    ? event
    : { ...event, detail: redactValues(event.detail, [], secrets) };
}

/**
 * Hold a substrate to one origin: `goto` and `fetch` throw for any other. Map
 * ops reach the network through these two, and an op route may be absolute.
 */
export function confineToOrigin(substrate: QaSubstrate, origin: string): QaSubstrate {
  const check = (url: string): void => {
    if (originOf(url) !== origin) {
      throw new QaError(
        "precondition_failed",
        `request to ${url} leaves the environment origin ${origin}`,
      );
    }
  };

  return new Proxy(substrate, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const method = value as (...args: unknown[]) => unknown;

      if (property === "goto") {
        return (url: string, ...rest: unknown[]) => {
          check(url);
          return method.call(target, url, ...rest);
        };
      }
      if (property === "fetch") {
        return (request: { url: string }, ...rest: unknown[]) => {
          check(request.url);
          return method.call(target, request, ...rest);
        };
      }
      return method.bind(target);
    },
  });
}

async function attemptCore(
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
    const created = await create({
      baseUrl: input.baseUrl,
      headless: input.headless ?? true,
      ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
      timeoutMs: input.timeoutMs ?? 15_000,
      ...(input.environment !== undefined
        ? { storageState: input.environment.storageState, readOnly: !input.environment.writes }
        : {}),
    });
    substrate =
      input.environment === undefined
        ? created
        : confineToOrigin(created, input.environment.origin);

    const live = substrate;
    const context: ResolveContext = {
      fixtures: input.fixtures ?? {},
      env: input.env ?? process.env,
      redact,
      ...(input.secretValues !== undefined ? { secrets: input.secretValues } : {}),
      ...(input.environment !== undefined
        ? { beforeEnv: () => assertOnOrigin(live, input.environment as RunEnvironment) }
        : {}),
    };

    for (const [offset, raw] of spec.setup.entries()) {
      const step = resolveStep(raw, context) as QaStep;
      const stepStarted = now().getTime();
      try {
        await executeStep(step, substrate, {
          baseUrl: input.baseUrl,
          ...(input.environment !== undefined ? { origin: input.environment.origin } : {}),
          timeoutMs: input.timeoutMs ?? 15_000,
          sleep: input.sleep ?? sleep,
          now,
          map:
            governedMap(spec) === undefined
              ? undefined
              : input.loadMap?.(governedMap(spec)?.site as string, governedMap(spec)?.version),
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
          ...(input.environment !== undefined ? { origin: input.environment.origin } : {}),
          timeoutMs: input.timeoutMs ?? 15_000,
          sleep: input.sleep ?? sleep,
          now,
          map:
            governedMap(spec) === undefined
              ? undefined
              : input.loadMap?.(governedMap(spec)?.site as string, governedMap(spec)?.version),
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
      governedMap(spec) === undefined
        ? undefined
        : input.loadMap?.(governedMap(spec)?.site as string, governedMap(spec)?.version);

    let current = view;
    for (const [offset, check] of spec.expect.entries()) {
      const retried = await checkWithRetry({
        check,
        view: current,
        substrate,
        ...(map ? { map } : {}),
        timeoutMs: input.timeoutMs ?? 15_000,
        now,
        sleep: input.sleep ?? sleep,
      });
      const outcome = retried.outcome;
      current = retried.view;
      if (!outcome.ok) {
        const artifacts = await failureArtifacts(substrate, input);
        return failResult(spec, attempt, started, now, {
          status: "fail",
          code: "assertion_failed",
          reason: outcome.message,
          step: spec.steps.length + offset,
          expected: outcome.expected,
          actual: outcome.actual,
          events,
          view: current,
          substrate,
          input,
          evidenceMode,
          artifacts,
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
    const artifacts =
      substrate === undefined ? undefined : await failureArtifacts(substrate, input);

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
      ...(artifacts !== undefined ? { artifacts } : {}),
    });
  } finally {
    await substrate?.close?.();
  }
}

/**
 * Replay a case's setup and its first `uptoStep` steps against an existing
 * substrate. Used by `qa repair` to reach the point of a recorded failure.
 * Throws the typed step error when the prefix itself fails.
 */
export async function replaySteps(input: {
  spec: QaCase;
  /** Exclusive upper bound on `spec.steps`; setup always runs in full. */
  uptoStep: number;
  substrate: QaSubstrate;
  baseUrl: string;
  timeoutMs?: number;
  fixtures?: Fixtures;
  env?: NodeJS.ProcessEnv;
  redact?: string[];
  environment?: RunEnvironment;
  loadMap?: (site: string, version?: number) => SiteMap | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): Promise<void> {
  const secrets = new Set<string>();
  const substrate =
    input.environment === undefined
      ? input.substrate
      : confineToOrigin(input.substrate, input.environment.origin);
  const context: ResolveContext = {
    fixtures: input.fixtures ?? {},
    env: input.env ?? process.env,
    redact: input.redact ?? [],
    secrets,
    ...(input.environment !== undefined
      ? { beforeEnv: () => assertOnOrigin(substrate, input.environment as RunEnvironment) }
      : {}),
  };
  const map =
    governedMap(input.spec) === undefined
      ? undefined
      : input.loadMap?.(governedMap(input.spec)?.site as string, governedMap(input.spec)?.version);

  try {
    for (const steps of [
      input.spec.setup,
      input.spec.steps.slice(0, Math.max(0, input.uptoStep)),
    ]) {
      for (const step of steps) {
        await executeStep(resolveStep(step, context) as QaStep, substrate, {
          baseUrl: input.baseUrl,
          ...(input.environment !== undefined ? { origin: input.environment.origin } : {}),
          timeoutMs: input.timeoutMs ?? 15_000,
          sleep: input.sleep ?? sleep,
          now: input.now ?? (() => new Date()),
          ...(map !== undefined ? { map } : {}),
        });
      }
    }
  } catch (error) {
    if (error instanceof QaError && secrets.size > 0) {
      throw new QaError(
        error.code,
        redactText(error.message, [], secrets),
        redactValues(error.details, [], secrets) as Record<string, unknown> | undefined,
      );
    }
    throw error;
  }
}

/** A secret may only be typed into the environment it belongs to. */
function assertOnOrigin(substrate: QaSubstrate, environment: RunEnvironment): void {
  const url = substrate.state()?.snapshot.url;
  if (url === undefined || originOf(url) !== environment.origin) {
    throw new QaError(
      "precondition_failed",
      `refusing to use a credential on ${url === undefined ? "a blank page" : originOf(url)}; it is bound to ${environment.origin}`,
    );
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
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
    /** An environment run may not navigate off this origin. */
    origin?: string;
  },
): Promise<void> {
  if ("goto" in step) {
    const url = new URL(step.goto, options.baseUrl).toString();
    if (options.origin !== undefined && originOf(url) !== options.origin) {
      throw new QaError(
        "precondition_failed",
        `goto ${url} leaves the environment origin ${options.origin}`,
      );
    }
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
    const check = awaitCheck(step);
    let last = `await ${step.await}`;

    while (options.now().getTime() <= deadline) {
      // A wait for the page to change must look at the page as it is now.
      const view =
        step.await === "url" || step.await === "text"
          ? (substrate.state() ?? (await substrate.view()))
          : await substrate.view();

      const outcome =
        check === undefined
          ? { ok: false as const, message: last }
          : await evaluateCheck({ check, view, substrate });
      if (outcome.ok) return;
      last = outcome.message;

      await options.sleep(100);
    }

    throw new QaError("timeout", `await ${step.await} timed out after ${timeout}ms: ${last}`);
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

function resolveStep(step: QaStep, context: ResolveContext): unknown {
  const copy = JSON.parse(JSON.stringify(step)) as Record<string, unknown>;
  const plain = { ...context, allowEnv: false };
  if ("params" in copy) copy.params = resolveValues(copy.params, context);
  if ("value" in copy) copy.value = resolveValues(copy.value, context);
  if ("goto" in copy) copy.goto = resolveValues(copy.goto, plain);
  if ("contains" in copy) copy.contains = resolveValues(copy.contains, plain);
  if ("pattern" in copy) copy.pattern = resolveValues(copy.pattern, plain);
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
    artifacts?: FailureArtifacts;
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
      ...(input.artifacts !== undefined ? { artifacts: input.artifacts } : {}),
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

/**
 * A case marked `expect_failure` is judged against the failure verify
 * recorded: the same one is a known failure (the run stays green, and says
 * so), a pass means the app was fixed, and a different failure is a failure.
 */
export function classifyExpected(spec: QaCase, result: CaseResult): CaseResult {
  if (spec.expect_failure === undefined) return result;
  const issue = spec.expect_failure.issue;

  if (result.status === "pass") {
    return {
      ...result,
      status: "fixed",
      fail_reason: "the failure this case expected no longer happens",
      next: [
        `remove expect_failure from ${spec.id}${issue !== undefined ? ` and close ${issue}` : ""}, then qa verify ${spec.id}`,
      ],
    };
  }

  const known = spec.known_failure;
  if (
    result.status === "fail" &&
    known !== undefined &&
    result.fail_code === known.code &&
    (known.step === undefined || result.fail_step === known.step)
  ) {
    return {
      ...result,
      status: "known_failure",
      fail_reason: `known failure: ${spec.expect_failure.reason}${issue !== undefined ? ` (${issue})` : ""}; ${result.fail_reason ?? ""}`,
    };
  }

  return result;
}

function summarize(results: CaseResult[]): RunSummary {
  const summary: RunSummary = { pass: 0, fail: 0, skip: 0, error: 0 };
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1;
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

export function defaultCreateSubstrate(input: {
  headless: boolean;
  executablePath?: string;
  timeoutMs: number;
  storageState?: string;
  readOnly?: boolean;
}): Promise<QaSubstrate> {
  const executablePath = input.executablePath ?? findChrome();
  if (executablePath === undefined) {
    throw new QaError("harness_error", "no Chrome or Chromium found; set CHROME_PATH");
  }

  return PlaywrightEngine.launch({
    executablePath,
    headless: input.headless,
    timeoutMs: input.timeoutMs,
    ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
    ...(input.readOnly === true ? { readOnly: true } : {}),
  }).then((engine) => new Substrate(engine));
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The check an `await` step waits for, or an error when it is missing what it needs. */
function awaitCheck(step: Extract<QaStep, { await: string }>): QaCheck | undefined {
  switch (step.await) {
    case "url":
      if (step.pattern === undefined)
        throw new QaError("invalid_request", "await url needs a pattern");
      return { url: step.pattern };
    case "text":
      if (step.contains === undefined)
        throw new QaError("invalid_request", "await text needs contains");
      return { text: { contains: step.contains } };
    case "visible":
    case "absent":
      if (step.target === undefined) {
        throw new QaError("invalid_request", `await ${step.await} needs a target locator`);
      }
      return step.await === "visible" ? { visible: step.target } : { absent: step.target };
    case "value":
      if (step.target === undefined || step.equals === undefined) {
        throw new QaError("invalid_request", "await value needs a target and equals");
      }
      return { value: { target: step.target, equals: step.equals } };
  }
}

/**
 * Evaluate a check, trying again until it passes or the time is up. An async UI
 * has not rendered the moment the last step returns, and a check that runs
 * once either flakes or, for `absent`, passes before the page exists.
 */
async function checkWithRetry(input: {
  check: QaCheck;
  view: QaView;
  substrate: QaSubstrate;
  map?: SiteMap;
  timeoutMs: number;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ outcome: CheckOutcome; view: QaView }> {
  let view = input.view;
  const deadline = input.now().getTime() + input.timeoutMs;

  for (;;) {
    const outcome = await evaluateCheck({
      check: input.check,
      view,
      substrate: input.substrate,
      ...(input.map !== undefined ? { map: input.map } : {}),
    });
    if (outcome.ok || input.now().getTime() >= deadline) return { outcome, view };

    await input.sleep(100);
    view = await input.substrate.view();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What only an async read can give a failure's evidence folder. */
type FailureArtifacts = { text?: string; screenshot?: Uint8Array };

/**
 * The page text and, when the run asks for screenshots, a screenshot, taken
 * while the failing page is still open. Evidence is written synchronously
 * after, so this is the one place it can ask the browser.
 */
async function failureArtifacts(
  substrate: QaSubstrate,
  input: RunInput,
): Promise<FailureArtifacts | undefined> {
  if (input.evidenceRoot === undefined) return undefined;

  const artifacts: FailureArtifacts = {};
  try {
    artifacts.text = (await substrate.read()).text;
  } catch {
    // Evidence is best effort: a page that cannot be read still has a view.
  }
  if (input.screenshot === true) {
    try {
      const shot = await substrate.screenshot?.();
      if (shot !== undefined) artifacts.screenshot = shot;
    } catch {
      // Same: no screenshot is better than no evidence.
    }
  }
  return artifacts;
}

/** The dialog that scopes `read` to itself while it is open, if one is. */
function readScope(view: QaView): { scoped_to: "dialog"; name: string } | undefined {
  const dialog = view.snapshot.nodes.find(
    (node) => node.visible && (node.role === "dialog" || node.role === "alertdialog"),
  );
  return dialog === undefined ? undefined : { scoped_to: "dialog", name: dialog.name };
}

function writeEvidenceSync(input: {
  spec: QaCase;
  result: CaseResult;
  view: QaView;
  substrate?: QaSubstrate;
  input: RunInput;
  artifacts?: FailureArtifacts;
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
    writeFileSync(
      join(dir, "view.txt"),
      `${redactText(rendered.text, redact, input.input.secretValues)}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "result.json"),
      `${JSON.stringify(
        {
          ...(redactValues(
            scrubResult(input.result, input.input.secretValues ?? new Set()),
            redact,
            [],
            caseNames(input.result.case_id),
          ) as object),
          ...(readScope(input.view) !== undefined ? { read_scope: readScope(input.view) } : {}),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "events.jsonl"),
      `${(input.result.events ?? []).map((event) => JSON.stringify(redactValues(scrubEvent(event, input.input.secretValues ?? new Set()), redact))).join("\n")}\n`,
      "utf8",
    );
    if (input.artifacts?.text !== undefined) {
      writeFileSync(
        join(dir, "text.txt"),
        `${redactText(input.artifacts.text, redact, input.input.secretValues)}\n`,
        "utf8",
      );
    }
    if (input.artifacts?.screenshot !== undefined) {
      writeFileSync(join(dir, "page.png"), input.artifacts.screenshot);
    }
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
    writeFileSync(
      join(dir, "view.txt"),
      `${redactText(rendered.text, redact, input.input.secretValues)}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "result.json"),
      `${JSON.stringify(
        redactValues(
          scrubResult(input.result, input.input.secretValues ?? new Set()),
          redact,
          [],
          caseNames(input.result.case_id),
        ),
        null,
        2,
      )}\n`,
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
