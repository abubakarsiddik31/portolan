import type { Extractor, JsonSchema, OpDef, UrlImpl } from "@abubakarsiddiik/protocol";

import type { ParameterizedSegment } from "./parameterize.js";
import type { InferredReturns } from "./returns.js";

export type UrlLift = {
  /** A route template such as `/search?q={query}`. */
  route: string;
  extract: Extractor;
  /** The params the route needs, in the order they were bound. */
  params: string[];
};

/**
 * Lift a read segment to a `url` route.
 *
 * The route is built from the post-state URL: a query value or path segment
 * that equals a bound param becomes `{name}`. Empty query params are dropped,
 * so a filter form's `q=` and `category=` do not end up in the route.
 *
 * Returns undefined when no bound param appears in the URL; that segment is
 * not URL-liftable.
 */
export function liftUrl(input: {
  segment: ParameterizedSegment;
  returns: InferredReturns;
}): UrlLift | undefined {
  const url = input.segment.segment.url;
  if (url === undefined) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url, "http://portolan.local");
  } catch {
    return undefined;
  }

  const path = parsed.pathname.split("/");
  const query = new URLSearchParams(parsed.search);
  const params: string[] = [];

  for (const binding of input.segment.params) {
    const value = String(binding.value);

    let matched = false;

    for (const [key, queryValue] of [...query]) {
      if (queryValue !== value) continue;
      query.set(key, `{${binding.name}}`);
      params.push(binding.name);
      matched = true;
      break;
    }

    if (matched) continue;

    const index = path.indexOf(value);
    if (index >= 0) {
      path[index] = `{${binding.name}}`;
      params.push(binding.name);
    }
  }

  if (params.length === 0) return undefined;

  const search = renderQuery(query);
  const route = `${path.join("/")}${search}`;

  return { route, extract: input.returns.extractor, params };
}

/** Apply a lifted route and returns schema to an op, replacing its url impl. */
export function withUrlLift(op: OpDef, lift: UrlLift, returns: JsonSchema): OpDef {
  const impl: UrlImpl = {
    tier: "url",
    route: lift.route,
    extract: lift.extract,
  };

  return {
    ...op,
    returns,
    impls: [impl, ...op.impls.filter((candidate) => candidate.tier !== "url")],
  };
}

function renderQuery(query: URLSearchParams): string {
  const parts: string[] = [];

  for (const [key, value] of query) {
    if (value === "") continue;
    parts.push(`${key}=${value.startsWith("{") ? value : encodeURIComponent(value)}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
