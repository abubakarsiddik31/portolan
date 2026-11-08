import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { NetworkEffect } from "@portolan/substrate";

import type { Trace, TraceEntry } from "./fallback.js";

/** One JSON line per trace. Append-only, so a run is never rewritten. */
export const TRACE_FILE = "traces.jsonl";

export type HarHeader = { name: string; value: string };

export type HarPostData = {
  mimeType: string;
  text: string;
};

export type HarContent = {
  size: number;
  mimeType: string;
  text: string;
};

export type HarRequest = {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  queryString: HarHeader[];
  cookies: HarHeader[];
  headersSize: number;
  bodySize: number;
  postData?: HarPostData;
};

export type HarResponse = {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  cookies: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
};

export type HarEntry = {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
};

export type Har = {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
};

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/**
 * Append-only trace storage.
 *
 * JSONL is the source of truth: every trace is one line, written once. HAR is
 * an export for browser devtools and other HTTP tooling; it is derived from
 * the same trace, so it can always be regenerated.
 */
export class TraceStore {
  constructor(readonly dir: string) {}

  private file(): string {
    return join(this.dir, TRACE_FILE);
  }

  /** Append one trace as a JSON line. Returns the file it wrote. */
  async append(trace: Trace): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file(), `${JSON.stringify(trace)}\n`, "utf8");
    return this.file();
  }

  /** Read every trace back, in append order. */
  async all(): Promise<Trace[]> {
    let text: string;

    try {
      text = await readFile(this.file(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const traces: Trace[] = [];

    for (const [index, line] of text.split("\n").entries()) {
      if (line.trim().length === 0) continue;

      try {
        traces.push(JSON.parse(line) as Trace);
      } catch (error) {
        throw new Error(`invalid trace at ${this.file()}:${index + 1}`, { cause: error });
      }
    }

    return traces;
  }

  /** The last trace written for a scope. */
  async get(scopeId: string): Promise<Trace | undefined> {
    const traces = await this.all();
    return traces.findLast((trace) => trace.scope_id === scopeId);
  }

  /** Write the trace's network effects as a HAR 1.2 file. */
  async writeHar(trace: Trace, path?: string): Promise<string> {
    const target = path ?? join(this.dir, `${trace.scope_id}.har`);

    await mkdir(this.dir, { recursive: true });
    await writeFile(target, `${JSON.stringify(toHar(trace), null, 2)}\n`, "utf8");
    return target;
  }
}

/** Project a trace's network effects into a HAR 1.2 document. */
export function toHar(trace: Trace): Har {
  const entries: HarEntry[] = [];

  for (const entry of trace.entries) {
    for (const effect of networkEffects(entry)) {
      entries.push(toHarEntry(entry.at, effect));
    }
  }

  return {
    log: {
      version: "1.2",
      creator: { name: "portolan", version: "0.0.0" },
      entries,
    },
  };
}

function networkEffects(entry: TraceEntry): NetworkEffect[] {
  if (entry.kind !== "act") return [];
  return entry.effects.filter((effect): effect is NetworkEffect => effect.kind === "network");
}

function toHarEntry(at: string, effect: NetworkEffect): HarEntry {
  const requestText =
    effect.request_body === undefined ? undefined : JSON.stringify(effect.request_body);
  const responseText =
    effect.response_body === undefined ? "" : JSON.stringify(effect.response_body);
  const status = effect.status ?? 0;

  return {
    startedDateTime: at,
    // The action settles on network idle; the engine does not time each
    // request, so zero is honest rather than invented.
    time: 0,
    request: {
      method: effect.method,
      url: effect.url,
      httpVersion: "HTTP/1.1",
      headers: [],
      queryString: queryString(effect.url),
      cookies: [],
      headersSize: -1,
      bodySize: requestText?.length ?? 0,
      ...(requestText !== undefined
        ? { postData: { mimeType: "application/json", text: requestText } }
        : {}),
    },
    response: {
      status,
      statusText: STATUS_TEXT[status] ?? "",
      httpVersion: "HTTP/1.1",
      headers: [],
      cookies: [],
      content: {
        size: responseText.length,
        mimeType: effect.mime_type ?? "",
        text: responseText,
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: responseText.length,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

function queryString(url: string): HarHeader[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}
