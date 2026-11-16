import type { OpDef, SiteMap, UrlImpl } from "@portolan/protocol";
import type { Substrate } from "@portolan/substrate";

import { checkPost, extract, validateReturns } from "./extract.js";
import { recognizeState } from "./state.js";
import { fillRoute } from "./template.js";

export type UrlRunInput = {
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
  substrate: Substrate;
  /** Override the map's origin, e.g. a fixture on an ephemeral port. */
  baseUrl?: string;
};

export type UrlRunResult =
  | { ok: true; result: unknown; state: string; url: string }
  | {
      ok: false;
      code: "op_broken" | "invalid_params";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Run a `url` op: fill the route template, navigate, check the
 * postconditions, extract the return value, and validate it.
 *
 * The `url` tier is read-only. A write must use `ui` or `http`, because a
 * navigation has no outcome check and no confirmation step.
 */
export async function runUrlOp(input: UrlRunInput): Promise<UrlRunResult> {
  const { map, op, params, substrate, baseUrl } = input;

  if (op.effect !== "read") {
    return {
      ok: false,
      code: "op_broken",
      message: `op "${op.name}" is ${op.effect}; the url tier is read-only`,
    };
  }

  const impl = op.impls.find((candidate): candidate is UrlImpl => candidate.tier === "url");
  if (impl === undefined) {
    return { ok: false, code: "op_broken", message: `op "${op.name}" has no url impl` };
  }

  const route = fillRoute(impl.route, params);
  if (route === undefined) {
    return {
      ok: false,
      code: "invalid_params",
      message: `missing param in "${impl.route}"`,
    };
  }

  const base = baseUrl ?? map.origins[0];
  if (base === undefined) {
    return { ok: false, code: "op_broken", message: `site "${map.site}" has no origin` };
  }

  const url = route.startsWith("http") ? route : new URL(route, base).toString();
  const view = await substrate.goto(url, { settle: false });

  for (const check of op.post) {
    const failure = checkPost(check, map, view);
    if (failure !== undefined) {
      return { ok: false, code: "op_broken", message: failure };
    }
  }

  const extracted = extract(impl.extract, view);
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

  const finalState = recognizeState(map, view.snapshot);

  return {
    ok: true,
    result: validated.value,
    state: finalState?.state.id ?? "unknown",
    url: view.snapshot.url,
  };
}
