import type { JsonSchema, OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";

import { type SegmentLabel, segmentTrace, type TraceSegment } from "./segment.js";

export type ParamSource = "task" | "label" | "url" | "varying";

export type ParamBinding = {
  name: string;
  value: string | number;
  source: ParamSource;
  /** Index within the segment's actions; absent for a URL binding. */
  action?: number;
  /** True when the value changed across the traces in a multi-trace diff. */
  varying?: boolean;
};

export type ConstantBinding = {
  action: number;
  label: string;
  value: string;
};

export type ParameterizedSegment = {
  segment: TraceSegment;
  op?: string;
  params: ParamBinding[];
  constants: ConstantBinding[];
  /** Required op params that no binding covered. */
  missing: string[];
  schema: JsonSchema;
};

export type TraceInput = {
  trace: Trace;
  /** The task parameters that produced the trace, when they are known. */
  params?: Record<string, unknown>;
  /** Labels from `labelSegments`, used to resolve an ambiguous segment. */
  labels?: SegmentLabel[];
};

export type ParameterizedTrace = {
  trace: Trace;
  segments: ParameterizedSegment[];
};

const ALIASES: Record<string, string> = {
  "search products": "query",
  search: "query",
  query: "query",
  "full name": "name",
  name: "name",
  email: "email",
  address: "address",
  city: "city",
  "postal code": "postal",
  postal: "postal",
  zip: "postal",
  "card number": "card",
  card: "card",
  password: "password",
  status: "status",
  quantity: "qty",
  qty: "qty",
  "size / color": "variant_id",
  variant: "variant_id",
  company: "company",
  role: "role",
  "team size": "team_size",
  page: "page",
};

/**
 * Turn a trace's segments into params and constants.
 *
 * A segment that matches an existing op is parameterized against that op's
 * signature: a typed value or URL piece that fills a named param becomes a
 * param, and everything else stays a constant. A segment with no op is
 * parameterized by label and task value, and the multi-trace diff promotes a
 * constant when it changes between runs.
 */
export function parameterizeTrace(input: TraceInput, map: SiteMap): ParameterizedTrace {
  const segments = segmentTrace(input.trace, map);
  const acts = input.trace.entries.filter((entry): entry is TraceAct => entry.kind === "act");
  const labels = new Map((input.labels ?? []).map((label) => [label.index, label]));

  return {
    trace: input.trace,
    segments: segments.map((segment) =>
      parameterizeSegment({
        segment,
        acts,
        map,
        params: input.params,
        label: labels.get(segment.index),
      }),
    ),
  };
}

/**
 * Parameterize several traces and diff them.
 *
 * The first pass is independent. The second compares values in the same
 * segment and action slot: a value that changes is a param, even when the
 * first pass called it a constant.
 */
export function parameterizeTraces(inputs: TraceInput[], map: SiteMap): ParameterizedTrace[] {
  const results = inputs.map((input) => parameterizeTrace(input, map));
  const groups = new Map<string, Array<{ trace: number; segment: number }>>();

  results.forEach((result, trace) => {
    result.segments.forEach((segment, index) => {
      const key = segment.op ?? `segment:${index}`;
      const group = groups.get(key) ?? [];
      group.push({ trace, segment: index });
      groups.set(key, group);
    });
  });

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const paramValues = new Map<string, Set<string>>();
    const constantValues = new Map<string, Set<string>>();

    for (const member of group) {
      const segment = results[member.trace]?.segments[member.segment];
      if (segment === undefined) continue;

      for (const param of segment.params) {
        const values = paramValues.get(param.name) ?? new Set<string>();
        values.add(String(param.value));
        paramValues.set(param.name, values);
      }

      for (const constant of segment.constants) {
        const key = `${constant.action}`;
        const values = constantValues.get(key) ?? new Set<string>();
        values.add(constant.value);
        constantValues.set(key, values);
      }
    }

    for (const member of group) {
      const segment = results[member.trace]?.segments[member.segment];
      if (segment === undefined) continue;

      for (const param of segment.params) {
        if ((paramValues.get(param.name)?.size ?? 0) > 1) {
          param.varying = true;
          param.source = "varying";
        }
      }

      const promoted: ParamBinding[] = [];

      segment.constants = segment.constants.filter((constant) => {
        const values = constantValues.get(`${constant.action}`);
        if ((values?.size ?? 0) <= 1) return true;

        const name =
          paramName(constant.label, opOf(segment, map), constant.value, undefined) ??
          `param_${constant.action}`;

        promoted.push({
          name,
          value: coerce(constant.value, propertyOf(opOf(segment, map), name)),
          source: "varying",
          action: constant.action,
          varying: true,
        });
        return false;
      });

      for (const param of promoted) {
        if (!segment.params.some((existing) => existing.name === param.name)) {
          segment.params.push(param);
        }
      }

      rebuild(segment, opOf(segment, map));
    }
  }

  return results;
}

function parameterizeSegment(input: {
  segment: TraceSegment;
  acts: TraceAct[];
  map: SiteMap;
  params?: Record<string, unknown>;
  label?: SegmentLabel;
}): ParameterizedSegment {
  const op = resolveOp(input.segment, input.map, input.label);
  const beforeUrl = beforeUrlOf(input.segment, input.acts);
  const params: ParamBinding[] = [];
  const constants: ConstantBinding[] = [];
  const used = new Set<string>();

  for (const [index, action] of input.segment.actions.entries()) {
    if (action.do !== "fill" && action.do !== "select") continue;
    if (action.value === undefined) continue;

    const label = action.locator?.name ?? action.ref;
    const name = paramName(label, op, action.value, input.params);

    if (name !== undefined && (op === undefined || propertyOf(op, name) !== undefined)) {
      params.push({
        name,
        value: coerce(action.value, propertyOf(op, name)),
        source: taskValue(input.params, action.value) !== undefined ? "task" : "label",
        action: index,
      });
      used.add(name);
    } else {
      constants.push({ action: index, label, value: action.value });
    }
  }

  if (op !== undefined) {
    for (const name of requiredParams(op)) {
      if (used.has(name)) continue;

      const value =
        urlValue(beforeUrl, name, input.map, input.segment.from) ??
        urlValue(input.segment.url, name, input.map, input.segment.to);

      if (value !== undefined) {
        params.push({
          name,
          value: coerce(value, propertyOf(op, name)),
          source: "url",
        });
        used.add(name);
      }
    }
  }

  const segment: ParameterizedSegment = {
    segment: input.segment,
    ...(op !== undefined ? { op: op.name } : {}),
    params,
    constants,
    missing: op === undefined ? [] : requiredParams(op).filter((name) => !used.has(name)),
    schema: {},
  };

  rebuild(segment, op);
  return segment;
}

function rebuild(segment: ParameterizedSegment, op: OpDef | undefined): void {
  segment.schema = schemaFromBindings(segment.params);
  segment.missing =
    op === undefined
      ? []
      : requiredParams(op).filter((name) => !segment.params.some((p) => p.name === name));
}

function resolveOp(
  segment: TraceSegment,
  map: SiteMap,
  label: SegmentLabel | undefined,
): OpDef | undefined {
  if (label !== undefined && (label.action === "reuse" || label.action === "extend")) {
    const named = label.op === undefined ? undefined : map.ops.find((op) => op.name === label.op);
    if (named !== undefined) return named;
  }

  if (segment.candidate !== undefined) {
    return map.ops.find((op) => op.name === segment.candidate);
  }

  return undefined;
}

function opOf(segment: ParameterizedSegment, map: SiteMap): OpDef | undefined {
  return segment.op === undefined ? undefined : map.ops.find((op) => op.name === segment.op);
}

function paramName(
  label: string,
  op: OpDef | undefined,
  value: string,
  taskParams: Record<string, unknown> | undefined,
): string | undefined {
  const fromTask = taskValue(taskParams, value);
  if (fromTask !== undefined) return fromTask;

  if (op !== undefined) {
    const fromLabel = labelParam(label, op);
    if (fromLabel !== undefined) return fromLabel;

    const names = Object.keys(propertyMap(op));
    if (names.length === 1) return names[0];
  }

  return normalizeName(label);
}

function labelParam(label: string, op: OpDef): string | undefined {
  const normalized = normalizeLabel(label);
  const properties = propertyMap(op);

  if (properties[normalized] !== undefined) return normalized;

  const alias = ALIASES[normalized];
  if (alias !== undefined && properties[alias] !== undefined) return alias;

  if (normalized.startsWith("attachment") && properties.file_path !== undefined) {
    return "file_path";
  }

  for (const name of Object.keys(properties)) {
    if (normalized.split(" ").includes(name)) return name;
  }

  return undefined;
}

function taskValue(params: Record<string, unknown> | undefined, value: string): string | undefined {
  if (params === undefined) return undefined;

  for (const [name, candidate] of Object.entries(params)) {
    if (String(candidate) === value) return name;
  }

  return undefined;
}

function urlValue(
  url: string | undefined,
  name: string,
  map: SiteMap,
  stateId: string | undefined,
): string | undefined {
  if (url === undefined) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url, "http://portolan.local");
  } catch {
    return undefined;
  }

  const query = parsed.searchParams.get(name);
  if (query !== null) return query;

  const state =
    stateId === undefined ? undefined : map.states.find((candidate) => candidate.id === stateId);
  if (state?.url === undefined) return undefined;

  const pattern = state.url.split("?")[0]?.split("/") ?? [];
  const actual = parsed.pathname.split("/");

  if (pattern.length !== actual.length) return undefined;

  for (const [index, part] of pattern.entries()) {
    if (!part.startsWith(":")) continue;

    const placeholder = part.slice(1);
    if (placeholder !== name && !name.endsWith(placeholder)) continue;

    const value = actual[index];
    if (value !== undefined && value.length > 0) return value;
  }

  return undefined;
}

function beforeUrlOf(segment: TraceSegment, acts: TraceAct[]): string | undefined {
  const previous = acts[segment.start - 1]?.url;
  if (previous !== undefined) return previous;

  const first = acts[0]?.url;
  if (first !== undefined) return first;

  return undefined;
}

function propertyMap(op: OpDef): Record<string, JsonSchema> {
  const properties = op.params.properties;
  if (properties === undefined || properties === null || typeof properties !== "object") return {};
  return properties as Record<string, JsonSchema>;
}

function propertyOf(op: OpDef | undefined, name: string | undefined): JsonSchema | undefined {
  if (op === undefined || name === undefined) return undefined;
  return propertyMap(op)[name];
}

function requiredParams(op: OpDef): string[] {
  const required = op.params.required;
  if (!Array.isArray(required)) return Object.keys(propertyMap(op));
  return required.filter((name): name is string => typeof name === "string");
}

function coerce(value: string, property: JsonSchema | undefined): string | number {
  if (property?.type === "integer" || property?.type === "number") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return value;
}

function schemaFromBindings(params: ParamBinding[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};

  for (const param of params) {
    properties[param.name] =
      typeof param.value === "number"
        ? { type: Number.isInteger(param.value) ? "integer" : "number" }
        : { type: "string" };
  }

  return {
    type: "object",
    properties,
    required: params.map((param) => param.name),
    additionalProperties: false,
  };
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[*:]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeName(label: string): string {
  const normalized = normalizeLabel(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "value";
}
