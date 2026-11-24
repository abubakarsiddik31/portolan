import { TraceStore } from "@abubakarsiddiik/runtime";
import {
  assertBindAllowed,
  BrowserRegistry,
  createLogger,
  createServer,
  MapStore,
  type ServerOptions,
  SessionStore,
} from "@abubakarsiddiik/server";
import type { FastifyInstance } from "fastify";

import { createBrowserFactory, createPageless } from "../browser.js";
import type { CliConfig } from "../config.js";

export type ServeInput = {
  config: CliConfig;
  host?: string;
  port?: number;
  database?: string;
  maps?: string;
  /** Defaults to PORTOLAN_AUTH_TOKEN. */
  authToken?: string;
};

export type ServeDeps = {
  createApp?: (options: ServerOptions) => FastifyInstance;
  store?: SessionStore;
  /** Override the browser factory; tests pass a fake. */
  substrateFactory?: ServerOptions["substrateFactory"];
};

export type ServeHandle = {
  app: FastifyInstance;
  store: SessionStore;
  url: string;
  close: () => Promise<void>;
};

/** Build and start the HTTP + MCP server. */
export async function runServe(input: ServeInput, deps: ServeDeps = {}): Promise<ServeHandle> {
  const host = input.host ?? input.config.host;
  const port = input.port ?? input.config.port;
  const database = input.database ?? input.config.database;
  const maps = input.maps ?? input.config.maps;
  const authToken = input.authToken ?? process.env.PORTOLAN_AUTH_TOKEN;

  assertBindAllowed(host, {
    ...(authToken !== undefined ? { authToken } : {}),
    allowRemote: process.env.PORTOLAN_ALLOW_REMOTE === "1",
  });

  const store = deps.store ?? new SessionStore(database);
  const browsers = new BrowserRegistry();
  const factory = deps.substrateFactory ?? createBrowserFactory(input.config, browsers);
  const pageless = createPageless(input.config);
  const create = deps.createApp ?? createServer;
  const app = create({
    store,
    maps: new MapStore(maps),
    browsers,
    traceStore: new TraceStore(process.env.TRACES_DIR ?? input.config.traces),
    ...(pageless !== undefined ? { pageless } : {}),
    ...(factory !== undefined ? { substrateFactory: factory } : {}),
    ...(authToken !== undefined ? { authToken } : {}),
    logger: true,
    log: createLogger({
      level: input.config.logLevel,
      base: { service: "portolan-server" },
    }),
    sessionTtlMs: input.config.sessionTtlMs,
    maxOpenSessions: input.config.maxOpenSessions,
    cleanupIntervalMs: input.config.cleanupIntervalMs,
    recoverSessions: input.config.recoverSessions,
  });

  await app.listen({ port, host });

  const address = app.server.address();
  const url =
    address !== null && typeof address !== "string"
      ? `http://${host}:${address.port}`
      : `http://${host}:${port}`;

  return {
    app,
    store,
    url,
    close: async () => {
      await app.close();
      store.closeDatabase();
    },
  };
}
