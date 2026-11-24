import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isIdLike, type OpDef } from "@abubakarsiddiik/protocol";
import type { NetworkEffect } from "@abubakarsiddiik/substrate";

export const ENDPOINTS_FILE = "endpoints.json";

/**
 * One API endpoint of the site, as its own frontend calls it.
 *
 * The page is a view of these. A map built from the buttons describes the view;
 * this lists what the backend can actually do, so an endpoint no op calls is a
 * visible gap instead of a missing button nobody noticed.
 */
export type Endpoint = {
  id: string;
  method: string;
  /** Path with ids as `{id}`. */
  path: string;
  /** The API's origin, when it is not the page's. */
  origin?: string;
  /** Query parameter names. */
  query?: string[];
  /** Top-level keys of the JSON request body. */
  request_keys?: string[];
  /** Top-level keys of a JSON response, or of its items when it is a list. */
  response_keys?: string[];
  /** The response was a list. */
  list?: boolean;
  status: number[];
  /** State ids of the pages whose load or actions made the call. */
  pages: string[];
  /** The page sent a credential with it. */
  auth?: boolean;
  count: number;
  /** The op whose `http` impl calls it. */
  op?: string;
};

export type EndpointInventory = {
  schema: 1;
  site: string;
  generated_at: string;
  endpoints: Endpoint[];
};

export type ApiCall = { page: string; effect: NetworkEffect };

export function templatePath(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => (isIdLike(part) ? "{id}" : part))
    .join("/");
}

/** Group raw calls into endpoints: same method, same templated path. */
export function clusterEndpoints(calls: ApiCall[], pageOrigin: string): Endpoint[] {
  const byId = new Map<string, Endpoint>();

  for (const { page, effect } of calls) {
    let url: URL;
    try {
      url = new URL(effect.url);
    } catch {
      continue;
    }

    const path = templatePath(url.pathname);
    const origin = url.origin === pageOrigin ? undefined : url.origin;
    const id = `${effect.method} ${origin ?? ""}${path}`;

    const endpoint = byId.get(id) ?? {
      id,
      method: effect.method,
      path,
      ...(origin !== undefined ? { origin } : {}),
      status: [],
      pages: [],
      count: 0,
    };

    endpoint.count += 1;
    if (!endpoint.pages.includes(page)) endpoint.pages.push(page);
    if (effect.status !== undefined && !endpoint.status.includes(effect.status)) {
      endpoint.status.push(effect.status);
    }

    const query = [...url.searchParams.keys()];
    if (query.length > 0) {
      endpoint.query = [...new Set([...(endpoint.query ?? []), ...query])].sort();
    }

    const request = keysOf(effect.request_body);
    if (request !== undefined) {
      endpoint.request_keys = [
        ...new Set([...(endpoint.request_keys ?? []), ...request.keys]),
      ].sort();
    }

    const response = keysOf(effect.response_body);
    if (response !== undefined) {
      endpoint.response_keys = [
        ...new Set([...(endpoint.response_keys ?? []), ...response.keys]),
      ].sort();
      if (response.list) endpoint.list = true;
    }

    if (effect.auth !== undefined) endpoint.auth = true;
    byId.set(id, endpoint);
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function keysOf(value: unknown): { keys: string[]; list: boolean } | undefined {
  if (value === null || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    const first = value.find((item) => item !== null && typeof item === "object");
    return {
      keys: first === undefined || Array.isArray(first) ? [] : Object.keys(first as object),
      list: true,
    };
  }

  return { keys: Object.keys(value as object), list: false };
}

/** Mark each endpoint with the op whose `http` impl calls it. */
export function linkEndpoints(endpoints: Endpoint[], ops: OpDef[]): Endpoint[] {
  const called = new Map<string, string>();

  for (const op of ops) {
    for (const impl of op.impls) {
      if (impl.tier !== "http") continue;
      for (const step of impl.steps) {
        // Fill the placeholders first: a URL parser would percent-encode the braces.
        const filled = step.url.replace(/\{[^}]+\}/g, "{id}");
        let path = filled;
        try {
          path = decodeURI(new URL(filled, "http://portolan.local").pathname);
        } catch {
          // Keep the raw template.
        }
        const key = `${step.method} ${path}`;
        if (!called.has(key)) called.set(key, op.name);
      }
    }
  }

  return endpoints.map((endpoint) => {
    const op = called.get(`${endpoint.method} ${endpoint.path}`);
    const { op: _drop, ...rest } = endpoint;
    return op === undefined ? rest : { ...rest, op };
  });
}

export type EndpointCoverage = {
  total: number;
  covered: number;
  /** Writes no op calls: the part of the backend an agent cannot yet use. */
  uncoveredWrites: number;
};

export function endpointCoverage(endpoints: Endpoint[]): EndpointCoverage {
  return {
    total: endpoints.length,
    covered: endpoints.filter((endpoint) => endpoint.op !== undefined).length,
    uncoveredWrites: endpoints.filter(
      (endpoint) => endpoint.op === undefined && endpoint.method !== "GET",
    ).length,
  };
}

export function writeEndpoints(dir: string, inventory: EndpointInventory): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ENDPOINTS_FILE);
  writeFileSync(path, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  return path;
}

export function readEndpoints(dir: string): EndpointInventory | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, ENDPOINTS_FILE), "utf8")) as EndpointInventory;
  } catch {
    return undefined;
  }
}
