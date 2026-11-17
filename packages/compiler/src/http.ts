import type {
  Extractor,
  HttpImpl,
  HttpMethod,
  HttpStep,
  JsonSchema,
  OpDef,
} from "@abubakarsiddiik/protocol";
import type { NetworkEffect } from "@abubakarsiddiik/substrate";

import type { ParameterizedSegment } from "./parameterize.js";
import type { InferredReturns } from "./returns.js";

export type HttpLift = {
  steps: HttpStep[];
  extract: Extractor;
  params: string[];
  outcome_check?: string;
};

/**
 * Lift a write segment to the site's own HTTP calls.
 *
 * The trace already captured the request and response bodies per action
 * (T3.03). This finds the non-GET requests that succeeded, rebuilds them as
 * steps, and replaces every bound param's value with a `{name}` placeholder.
 *
 * A value from an earlier response that appears in a later request becomes a
 * `bind`, which is how a token or id reaches the second step. The dev fixtures
 * have no such token; the unit test covers the inference.
 */
export function liftHttp(input: {
  segment: ParameterizedSegment;
  returns: InferredReturns;
  outcomeCheck?: string;
}): HttpLift | undefined {
  const effects = input.segment.segment.actions
    .flatMap((action) => action.effects)
    .filter(isWriteRequest);

  if (effects.length === 0) return undefined;

  const bindings = input.segment.params.map((param) => ({
    name: param.name,
    value: String(param.value),
  }));
  const params = new Set<string>();
  const steps: HttpStep[] = [];

  for (const effect of effects) {
    const url = relativeUrl(effect.url);
    const body = replaceValues(effect.request_body, bindings, params);

    steps.push({
      method: effect.method as HttpMethod,
      url: replaceValues(url, bindings, params) as string,
      ...(body !== undefined
        ? {
            body,
            headers: { "content-type": "application/json" },
          }
        : {}),
    });
  }

  inferBinds(effects, steps);

  return {
    steps,
    extract: input.returns.extractor,
    params: [...params],
    ...(input.outcomeCheck !== undefined ? { outcome_check: input.outcomeCheck } : {}),
  };
}

/** Apply a lifted HTTP impl and returns schema to an op. */
export function withHttpLift(
  op: OpDef,
  lift: HttpLift,
  returns: JsonSchema,
  outcomeCheck?: string,
): OpDef {
  const impl: HttpImpl = {
    tier: "http",
    steps: lift.steps,
    extract: lift.extract,
  };

  const check = outcomeCheck ?? lift.outcome_check ?? op.outcome_check;

  return {
    ...op,
    returns,
    ...(check !== undefined ? { outcome_check: check } : {}),
    impls: [impl, ...op.impls.filter((candidate) => candidate.tier !== "http")],
  };
}

function isWriteRequest(effect: {
  kind: string;
  method?: string;
  status?: number;
  request_body?: unknown;
}): effect is NetworkEffect {
  return (
    effect.kind === "network" &&
    effect.method !== undefined &&
    effect.method !== "GET" &&
    effect.method !== "HEAD" &&
    effect.status !== undefined &&
    effect.status >= 200 &&
    effect.status < 300 &&
    effect.request_body !== undefined
  );
}

function relativeUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://portolan.local");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function replaceValues(
  value: unknown,
  bindings: Array<{ name: string; value: string }>,
  params: Set<string>,
): unknown {
  if (typeof value === "string") {
    const binding = bindings.find((candidate) => candidate.value === value);
    if (binding !== undefined) {
      params.add(binding.name);
      return `{${binding.name}}`;
    }
    return value;
  }

  if (typeof value === "number") {
    const binding = bindings.find((candidate) => candidate.value === String(value));
    if (binding !== undefined) {
      params.add(binding.name);
      return `{${binding.name}}`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceValues(item, bindings, params));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const binding = bindings.find((candidate) => candidate.name === key);
      if (binding !== undefined) {
        params.add(binding.name);
        result[key] = `{${binding.name}}`;
      } else {
        result[key] = replaceValues(item, bindings, params);
      }
    }
    return result;
  }

  return value;
}

function inferBinds(effects: NetworkEffect[], steps: HttpStep[]): void {
  for (let index = 1; index < effects.length; index += 1) {
    const previous = effects[index - 1];
    const current = effects[index];
    const step = steps[index];
    const previousStep = steps[index - 1];
    if (
      previous === undefined ||
      current === undefined ||
      step === undefined ||
      previousStep === undefined
    ) {
      continue;
    }

    const found = findResponseValue(previous.response_body, current.request_body, current.url);
    if (found === undefined) continue;

    previousStep.bind = { ...(previousStep.bind ?? {}), [found.key]: found.path };
    const replaced = replaceLiteral(step, found.value, `{${found.key}}`);
    steps[index] = replaced;
  }
}

function findResponseValue(
  response: unknown,
  request: unknown,
  url: string,
): { key: string; path: string; value: string } | undefined {
  const text = `${JSON.stringify(request ?? null)} ${url}`;

  for (const [path, value] of flatten(response)) {
    const literal = String(value);
    if (literal.length < 3 || !text.includes(literal)) continue;

    const key = path.split(".").pop() ?? path;
    return { key, path, value: literal };
  }

  return undefined;
}

function flatten(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (value === null || typeof value !== "object") return [[prefix, value]];

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flatten(item, prefix.length === 0 ? String(index) : `${prefix}.${index}`),
    );
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    flatten(item, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

function replaceLiteral(step: HttpStep, value: string, placeholder: string): HttpStep {
  return {
    ...step,
    url: step.url.replaceAll(value, placeholder),
    ...(step.body !== undefined ? { body: replaceInValue(step.body, value, placeholder) } : {}),
  };
}

function replaceInValue(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value === from ? to : value;
  if (Array.isArray(value)) return value.map((item) => replaceInValue(item, from, to));

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = replaceInValue(item, from, to);
    }
    return result;
  }

  return value;
}
