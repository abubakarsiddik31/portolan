import type { Extractor, HttpImpl, OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { HttpResponse } from "@abubakarsiddiik/substrate";

import { type ExtractResult, validateReturns } from "./extract.js";
import type { HttpTransport } from "./session-http.js";
import { fillRoute, fillTemplate } from "./template.js";

export type HttpRunInput = {
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
  /** A live page's `fetch`, or a saved session sent from Node (`sessionTransport`). */
  substrate: HttpTransport;
  /** Override the map's origin, e.g. a fixture on an ephemeral port. */
  baseUrl?: string;
};

export type HttpRunResult =
  | { ok: true; result: unknown; status: number; url: string }
  | {
      ok: false;
      code: "op_broken" | "invalid_params";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Run an `http` op: a sequence of fetches inside the live page, with the
 * page's cookies and origin, or from a saved session with no page at all.
 *
 * `bind` captures a value from a response for a later step, which is how a
 * CSRF token or an id returned by the first request reaches the second one.
 */
export async function runHttpOp(input: HttpRunInput): Promise<HttpRunResult> {
  const { map, op, params, substrate, baseUrl } = input;

  const impl = op.impls.find((candidate): candidate is HttpImpl => candidate.tier === "http");
  if (impl === undefined) {
    return { ok: false, code: "op_broken", message: `op "${op.name}" has no http impl` };
  }

  const base = baseUrl ?? map.origins[0];
  if (base === undefined) {
    return { ok: false, code: "op_broken", message: `site "${map.site}" has no origin` };
  }

  const bound: Record<string, unknown> = {};
  let last: HttpResponse | undefined;
  let lastUrl = "";

  for (const [index, step] of impl.steps.entries()) {
    const values = { ...params, ...bound };
    const route = fillRoute(step.url, values);

    if (route === undefined) {
      return {
        ok: false,
        code: "invalid_params",
        message: `step ${index}: missing param in "${step.url}"`,
      };
    }

    const url = route.startsWith("http") ? route : new URL(route, base).toString();

    const headers =
      step.headers === undefined
        ? undefined
        : (fillDeep(step.headers, values) as Record<string, string> | undefined);
    if (step.headers !== undefined && headers === undefined) {
      return {
        ok: false,
        code: "invalid_params",
        message: `step ${index}: missing param in headers`,
      };
    }

    const body = step.body === undefined ? undefined : fillDeep(step.body, values);
    if (step.body !== undefined && body === undefined) {
      return {
        ok: false,
        code: "invalid_params",
        message: `step ${index}: missing param in body`,
      };
    }

    const response = await substrate.fetch({
      method: step.method,
      url,
      headers,
      body,
      ...(impl.auth !== undefined ? { auth: impl.auth } : {}),
    });
    last = response;
    lastUrl = url;

    if (response.error !== undefined) {
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: ${response.error}`,
        details: { auth_missing: true },
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: HTTP ${response.status}`,
        details: { status: response.status, body: response.text.slice(0, 500) },
      };
    }

    if (step.bind !== undefined) {
      for (const [key, path] of Object.entries(step.bind)) {
        const value = pick(response.json, path);
        if (value === undefined) {
          return {
            ok: false,
            code: "op_broken",
            message: `step ${index}: bind "${key}" did not resolve from "${path}"`,
          };
        }
        bound[key] = value;
      }
    }
  }

  if (last === undefined) {
    return { ok: false, code: "op_broken", message: "http impl has no steps" };
  }

  const extracted = extractHttp(impl.extract, last);
  if (!extracted.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: extracted.message,
      ...(extracted.details !== undefined ? { details: extracted.details } : {}),
    };
  }

  const validated = validateReturns(op, extracted.value);
  if (!validated.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: validated.message,
      ...(validated.details !== undefined ? { details: validated.details } : {}),
    };
  }

  return { ok: true, result: validated.value, status: last.status, url: lastUrl };
}

function extractHttp(extractor: Extractor, response: HttpResponse): ExtractResult {
  if (extractor.kind === "json") {
    const value = pick(response.json, extractor.path);
    if (value === undefined) {
      return {
        ok: false,
        message: `json path "${extractor.path ?? ""}" did not resolve`,
        details: { body: response.text.slice(0, 500) },
      };
    }
    return { ok: true, value };
  }

  if (extractor.kind === "none") return { ok: true, value: {} };

  return { ok: false, message: "http extractors must be json or none" };
}

function fillDeep(value: unknown, params: Record<string, unknown>): unknown | undefined {
  if (typeof value === "string") return fillTemplate(value, params);

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const filled = fillDeep(item, params);
      if (filled === undefined) return undefined;
      result.push(filled);
    }
    return result;
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const filled = fillDeep(item, params);
      if (filled === undefined) return undefined;
      result[key] = filled;
    }
    return result;
  }

  return value;
}

function pick(value: unknown, path: string | undefined): unknown {
  if (path === undefined || path === "") return value;

  let current = value;

  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
