import { readFileSync } from "node:fs";

import type { Trace, TraceEntry } from "@abubakarsiddiik/runtime";

import { QaError } from "./errors.js";
import { parseCase, type QaCase, type QaLocator, type QaStep } from "./spec.js";

export type GenerateOptions = {
  /** Case id; derived from the title when omitted. */
  id?: string;
  /** Suite; "generated" when omitted. */
  suite?: string;
  /** Case title; the trace intent when omitted. */
  title?: string;
  /** Attach a map so a writing case can be classified as a write. */
  map?: { site: string; version: number; op: string };
  /** Secret-ish field names whose fill values become env references. */
  redact?: string[];
};

export type GeneratedCase = {
  spec: QaCase;
  /** What the generator changed or could not carry over. */
  warnings: string[];
};

const CASE_ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const DEFAULT_REDACT = ["password", "token", "secret", "authorization", "cookie"];

/**
 * Normalize an agent-authored case sketch into a valid draft spec.
 *
 * The agent supplies intent (title, steps, expect); this fills every default
 * it can (id, suite, routes, fixtures, effect) and refuses what it cannot.
 * The result is a draft: `qa_case_write` semantics, promoted only by verify.
 */
export function generateFromSpec(input: unknown, options: GenerateOptions = {}): GeneratedCase {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new QaError("spec_error", "the spec must be a JSON object");
  }

  const raw = input as Record<string, unknown>;
  const warnings: string[] = [];

  const title = asTitle(raw.title) ?? asTitle(options.title);
  if (title === undefined) {
    throw new QaError("spec_error", "a generated case needs a title");
  }

  const id = options.id ?? (typeof raw.id === "string" ? raw.id : slugify(title));
  if (typeof id !== "string" || !CASE_ID.test(id)) {
    throw new QaError("spec_error", `case id "${String(id)}" is not path-like (e.g. auth/login)`, {
      ...(options.id === undefined && raw.id === undefined
        ? { hint: `derived from the title as "${slugify(title)}"; pass an id to override` }
        : {}),
    });
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new QaError("spec_error", "a generated case needs a non-empty steps array");
  }

  const map = isMap(raw.map) ? raw.map : options.map;
  const effect =
    raw.effect === "read" || raw.effect === "write" || raw.effect === "irreversible"
      ? raw.effect
      : map !== undefined
        ? "write"
        : "read";

  const steps = raw.steps;
  const expect = Array.isArray(raw.expect) ? raw.expect : [];
  const routes = Array.isArray(raw.routes) ? (raw.routes as unknown[]) : routesFromSteps(steps);
  const fixtures = Array.isArray(raw.fixtures)
    ? (raw.fixtures as unknown[])
    : detectPlaceholders([steps, expect], "fixture");

  if (effect === "read" && writes(steps)) {
    warnings.push(
      'the steps write form fields but the case has no map, so it was classified "read"; attach a map and set effect "write" before promoting it',
    );
  }

  const spec = parseOrThrow({
    schema: 1,
    id,
    title,
    suite: asSuite(raw.suite) ?? options.suite ?? "generated",
    effect,
    status: "draft",
    tags: Array.isArray(raw.tags) ? raw.tags : ["generated"],
    touches: Array.isArray(raw.touches) ? raw.touches : [],
    routes,
    ...(map !== undefined ? { map } : {}),
    setup: Array.isArray(raw.setup) ? raw.setup : [],
    steps,
    expect,
    fixtures: fixtures.filter((item): item is string => typeof item === "string"),
    ...(isSource(raw.source) ? { source: raw.source } : { source: { kind: "generated" } }),
    ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
  });

  return { spec, warnings };
}

/**
 * Compile a recorded trace into a draft case.
 *
 * Views become `goto` steps when the route changes and no recorded act caused
 * the navigation; acts with locators become semantic steps; acts without a
 * locator are dropped (there is nothing to re-resolve on replay). Fill values
 * for secret-looking fields are replaced with `${env.*}` references so a
 * recorded credential never lands in a case file.
 */
export function generateFromTrace(trace: Trace, options: GenerateOptions = {}): GeneratedCase {
  const warnings: string[] = [];
  const redact = options.redact ?? DEFAULT_REDACT;

  const title = asTitle(options.title) ?? asTitle(trace.intent);
  if (title === undefined) {
    throw new QaError("spec_error", "the trace has no intent; pass a title");
  }

  const id = options.id ?? slugify(title);
  if (!CASE_ID.test(id)) {
    throw new QaError("spec_error", `case id "${id}" is not path-like; pass an id to override`);
  }

  const steps: QaStep[] = [];
  const routes: string[] = [];
  let lastPath: string | undefined;
  let droppedActs = 0;

  // A route change observed at an act is attributed to that act (the url is
  // recorded post-dispatch, after effects settle), so replay does not insert
  // a redundant goto after a click that navigated.
  for (const entry of trace.entries) {
    if (entry.kind === "view") {
      const path = pathnameOf(entry.url);
      if (path !== undefined && path !== lastPath) {
        if (!routes.includes(path)) routes.push(path);
        steps.push({ goto: path });
        lastPath = path;
      }
      continue;
    }

    if (entry.kind === "act") {
      const path = pathnameOf(entry.url);
      if (path !== undefined) lastPath = path;

      const step = actStep(entry, redact, warnings);
      if (step !== undefined) steps.push(step);
      else if (entry.locator === undefined && entry.do !== "press") droppedActs += 1;
    }
  }

  if (steps.length === 0) {
    throw new QaError(
      "spec_error",
      "the trace produced no steps (only views or locator-less acts)",
    );
  }

  if (droppedActs > 0) {
    warnings.push(`${droppedActs} recorded act(s) had no locator and were dropped`);
  }

  const map = options.map;
  const effect = trace.effect !== "read" && map === undefined ? "read" : trace.effect;
  if (effect !== trace.effect) {
    warnings.push(
      `the trace was a "${trace.effect}" scope but the case has no map, so it was classified "read"; attach a map and set effect "${trace.effect}" before promoting it`,
    );
  }

  const spec = parseOrThrow({
    schema: 1,
    id,
    title,
    suite: options.suite ?? "generated",
    effect,
    status: "draft",
    tags: ["generated"],
    touches: [],
    routes,
    ...(map !== undefined ? { map } : {}),
    setup: [],
    steps,
    expect: [],
    fixtures: [],
    source: { kind: "trace", trace_id: trace.scope_id },
  });

  return { spec, warnings };
}

/** Read and shape-check a recorded trace file. */
export function readTraceFile(path: string): Trace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new QaError("spec_error", `${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new QaError("spec_error", `${path} is not a trace: it has no entries array`);
  }

  return parsed as Trace;
}

function actStep(
  entry: Extract<TraceEntry, { kind: "act" }>,
  redact: string[],
  warnings: string[],
): QaStep | undefined {
  const act = entry.do;

  if (act === "press") {
    return entry.key === undefined ? undefined : { do: "press", key: entry.key };
  }

  if (
    act !== "click" &&
    act !== "check" &&
    act !== "uncheck" &&
    act !== "fill" &&
    act !== "select"
  ) {
    return undefined;
  }

  if (entry.locator === undefined) return undefined;
  const target = traceLocator(entry.locator);

  if (act === "fill" || act === "select") {
    const value = secretSafeValue(entry.value ?? "", target, entry.locator.name, redact, warnings);
    return { do: act, target, value };
  }

  return { do: act, target };
}

function traceLocator(locator: { role: string; name: string; ordinal: number }): QaLocator {
  return {
    role: locator.role,
    name: locator.name,
    ...(locator.ordinal > 0 ? { ordinal: locator.ordinal } : {}),
  };
}

function secretSafeValue(
  value: string,
  target: QaLocator,
  fieldName: string | undefined,
  redact: string[],
  warnings: string[],
): string {
  const name = fieldName ?? target.name ?? "";
  const secretish = redact.some((token) => name.toLowerCase().includes(token.toLowerCase()));

  if (value.length === 0 || !secretish) return value;

  const env = `QA_${slugify(name).toUpperCase().replace(/-/g, "_")}`;
  warnings.push(
    `fill for "${name}" was replaced with \`\${env.${env}}\`; set it before running or verifying this case`,
  );
  return `\${env.${env}}`;
}

function parseOrThrow(input: Record<string, unknown>): QaCase {
  try {
    return parseCase(input);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "ZodError" ? summarizeZod(error) : String(error);
    throw new QaError("spec_error", `the generated case is not valid: ${message}`);
  }
}

function summarizeZod(
  error: Error & { issues?: Array<{ path: (string | number)[]; message: string }> },
): string {
  return (error.issues ?? [])
    .map((issue) => `${issue.path.join(".") || "case"} ${issue.message}`)
    .join("; ");
}

function routesFromSteps(steps: unknown[]): string[] {
  const routes: string[] = [];
  for (const step of steps) {
    if (step === null || typeof step !== "object") continue;
    const path = (step as Record<string, unknown>).goto;
    if (typeof path !== "string") continue;
    const route = pathnameOf(path) ?? path;
    if (!routes.includes(route)) routes.push(route);
  }
  return routes;
}

/** Collect `fixture` names referenced by `${fixture.<name>...}` placeholders. */
function detectPlaceholders(values: unknown[], scope: "fixture" | "env"): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`\\$\\{${scope}\\.([A-Za-z0-9_.-]+)\\}`, "g");

  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(pattern)) {
        const name = match[1]?.split(".")[0];
        if (name !== undefined) found.add(name);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };

  for (const value of values) walk(value);
  return [...found];
}

function writes(steps: unknown[]): boolean {
  return steps.some((step) => {
    if (step === null || typeof step !== "object") return false;
    const record = step as Record<string, unknown>;
    return record.do === "fill" || record.do === "select" || record.op !== undefined;
  });
}

function isMap(value: unknown): value is { site: string; version: number; op: string } {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.site === "string" &&
    typeof record.version === "number" &&
    typeof record.op === "string"
  );
}

function isSource(
  value: unknown,
): value is { kind: "manual" | "trace" | "generated"; trace_id?: string; commit?: string } {
  if (value === null || typeof value !== "object") return false;
  const kind = (value as Record<string, unknown>).kind;
  return kind === "manual" || kind === "trace" || kind === "generated";
}

function asTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asSuite(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** "Login flow — happy path" → "login-flow-happy-path". */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

function pathnameOf(url: string): string | undefined {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url.startsWith("/") ? url : undefined;
  }
}
