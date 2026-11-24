import { readFileSync } from "node:fs";

import type { HttpAuth, HttpRequest, HttpResponse } from "@abubakarsiddiik/substrate";

/** What `runHttpOp` needs to send a request: a page's `fetch`, or this module's. */
export type HttpTransport = {
  fetch(request: HttpRequest): Promise<HttpResponse>;
};

/** A saved browser session, in Playwright's `storageState` format. */
export type StorageState = {
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    secure?: boolean;
  }>;
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
};

export function readStorageState(path: string): StorageState | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StorageState;
  } catch {
    return undefined;
  }
}

export type SessionTransportOptions = {
  state: StorageState;
  /** The origin the signed-in app is served from; its storage holds the token. */
  pageOrigin: string;
  /** Throws to refuse a URL, e.g. the egress policy. */
  guard?: (url: string, method: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Send an op's requests from Node with a saved session, without a browser.
 *
 * The browser only supplied three things: cookies, the token the app keeps in
 * `localStorage`, and the right origin. All three are in the saved session, so
 * an `http` op does not need a page, a render or a settle. A request carries
 * the session's cookies for the URL it goes to, as a browser would; `auth`
 * adds the bearer token read from the app's `localStorage`.
 *
 * `sessionStorage` is not saved with a session, so a token kept there cannot be
 * read here. That fails with `auth_missing` and the caller falls back to a page.
 */
export function sessionTransport(options: SessionTransportOptions): HttpTransport {
  const send = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now() / 1000);

  return {
    async fetch(request) {
      const headers: Record<string, string> = { ...(request.headers ?? {}) };
      const auth = request.auth;

      if (auth?.kind === "bearer") {
        const value = bearerValue(auth, options);
        if (value === undefined) {
          return {
            status: 0,
            text: "",
            json: undefined,
            error: `no ${auth.source} entry "${auth.key}" in the saved session; sign in again`,
          };
        }
        headers[(auth.header ?? "authorization").toLowerCase()] = value;
      }

      const cookie = cookieHeader(options.state, request.url, now());
      if (cookie !== undefined && !hasHeader(headers, "cookie")) headers.cookie = cookie;

      await options.guard?.(request.url, request.method);

      const hasBody = request.body !== undefined;
      if (hasBody && !hasHeader(headers, "content-type")) {
        headers["content-type"] = "application/json";
      }

      const response = await send(request.url, {
        method: request.method,
        headers: {
          ...headers,
          // The app sends these from its own origin, and some APIs check them.
          ...(hasHeader(headers, "origin") ? {} : { origin: options.pageOrigin }),
        },
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        redirect: "follow",
      });

      // A redirect may have left the allowed hosts; refuse to hand it back.
      if (response.url !== "" && response.url !== request.url) {
        await options.guard?.(response.url, request.method);
      }

      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }

      return { status: response.status, text, json, url: response.url };
    },
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function bearerValue(
  auth: Extract<HttpAuth, { kind: "bearer" }>,
  options: SessionTransportOptions,
): string | undefined {
  let raw: string | undefined;

  if (auth.source === "localStorage") {
    raw = options.state.origins
      ?.find((entry) => entry.origin === options.pageOrigin)
      ?.localStorage?.find((item) => item.name === auth.key)?.value;
  } else if (auth.source === "cookie") {
    raw = options.state.cookies?.find((cookie) => cookie.name === auth.key)?.value;
    if (raw !== undefined) {
      try {
        raw = decodeURIComponent(raw);
      } catch {
        // Keep the value as stored.
      }
    }
  }
  if (raw === undefined) return undefined;

  let token: unknown = raw;
  if (auth.path !== undefined && auth.path !== "") {
    try {
      token = auth.path
        .split(".")
        .reduce<unknown>(
          (value, key) =>
            value !== null && typeof value === "object"
              ? (value as Record<string, unknown>)[key]
              : undefined,
          JSON.parse(raw),
        );
    } catch {
      return undefined;
    }
  }
  if (typeof token !== "string" || token === "") return undefined;

  const scheme = auth.scheme ?? "Bearer";
  return scheme === "" ? token : `${scheme} ${token}`;
}

/** The cookies a browser would send to `url`: domain, path, scheme and expiry. */
function cookieHeader(state: StorageState, url: string, now: number): string | undefined {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }

  const pairs = (state.cookies ?? [])
    .filter((cookie) => {
      if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires < now) return false;
      if (cookie.secure === true && target.protocol !== "https:") return false;

      const domain = cookie.domain.replace(/^\./, "");
      const hostMatches = cookie.domain.startsWith(".")
        ? target.hostname === domain || target.hostname.endsWith(`.${domain}`)
        : target.hostname === domain;
      if (!hostMatches) return false;

      const path = cookie.path === "" ? "/" : cookie.path;
      return (
        target.pathname === path ||
        target.pathname.startsWith(path.endsWith("/") ? path : `${path}/`)
      );
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  return pairs.length === 0 ? undefined : pairs.join("; ");
}
