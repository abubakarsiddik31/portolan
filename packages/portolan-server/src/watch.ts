import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { ActivityEvent, ActivityFeed } from "./activity.js";
import { WATCH_PAGE } from "./watch-page.js";

export const DEFAULT_WATCH_PORT = 4300;

export type WatchServerOptions = {
  feed: ActivityFeed;
  /** Default 127.0.0.1. The page shows what the agent sees, so keep it local. */
  host?: string;
  /** Default 4300. When taken, the next free port up to +9 is used. */
  port?: number;
};

export type WatchServerHandle = {
  url: string;
  close: () => Promise<void>;
};

/**
 * Serve a live view of the agent: the browser page it is driving, and every
 * MCP tool call it makes.
 *
 * `GET /` is the viewer; `GET /events` is a server-sent event stream that
 * replays recent activity, then follows it. Only requests addressed to a
 * loopback host name are answered, so a web page cannot read the stream by
 * rebinding its own domain to 127.0.0.1.
 */
export async function startWatchServer(options: WatchServerOptions): Promise<WatchServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const first = options.port ?? DEFAULT_WATCH_PORT;
  const streams = new Set<ServerResponse>();

  const server = createServer((request, response) => {
    if (!loopbackHost(request)) {
      response.writeHead(403).end();
      return;
    }

    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }

    if (path === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      response.end(WATCH_PAGE);
      return;
    }

    if (path === "/events") {
      openStream(response, options.feed, streams);
      return;
    }

    response.writeHead(404).end();
  });

  const port = await listen(server, host, first, first === 0 ? 0 : 9);
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return {
    url: `http://${shown}:${port}`,
    close: async () => {
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function openStream(
  response: ServerResponse,
  feed: ActivityFeed,
  streams: Set<ServerResponse>,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });

  const send = (event: ActivityEvent): void => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of feed.snapshot()) send(event);
  const unsubscribe = feed.subscribe(send);
  streams.add(response);

  // Proxies and browsers drop a stream that goes quiet; a comment keeps it up.
  const ping = setInterval(() => response.write(": ping\n\n"), 15_000);
  ping.unref();

  response.on("close", () => {
    clearInterval(ping);
    unsubscribe();
    streams.delete(response);
  });
}

function loopbackHost(request: IncomingMessage): boolean {
  const header = request.headers.host;
  if (header === undefined) return false;
  const name = header.startsWith("[")
    ? header.slice(0, header.indexOf("]") + 1)
    : header.split(":")[0];
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

async function listen(server: Server, host: string, port: number, spare: number): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port + attempt, host);
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      const taken = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!taken || attempt >= spare) throw error;
    }
  }
}
