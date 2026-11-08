import {
  createLogger,
  createServer,
  MapStore,
  type ServerOptions,
  SessionStore,
} from "@portolan/server";
import type { FastifyInstance } from "fastify";

import type { CliConfig } from "../config.js";

export type ServeInput = {
  config: CliConfig;
  host?: string;
  port?: number;
  database?: string;
  maps?: string;
};

export type ServeDeps = {
  createApp?: (options: ServerOptions) => FastifyInstance;
  store?: SessionStore;
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

  const store = deps.store ?? new SessionStore(database);
  const create = deps.createApp ?? createServer;
  const app = create({
    store,
    maps: new MapStore(maps),
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
