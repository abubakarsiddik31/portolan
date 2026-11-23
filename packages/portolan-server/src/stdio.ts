import { PORTOLAN_DIR, type SessionRecord } from "@abubakarsiddiik/protocol";
import type { TraceStore, WriteLedger } from "@abubakarsiddiik/runtime";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { BrowserRegistry } from "./browsers.js";
import type { OpExecutor } from "./executor.js";
import { MapStore } from "./maps.js";
import { createMcpServer, type FallbackSubstrate, type MappingTools } from "./mcp.js";
import { SessionStore } from "./store.js";

export type StdioServerOptions = {
  /** Directory of `maps/<site>/v<n>.json`. Default `MAPS_DIR` or `.portolan/maps`. */
  mapsDir?: string;
  /** SQLite path. Default `DATABASE_PATH` or `.portolan/state/portolan.db`. */
  databasePath?: string;
  /** Defaults to a stdio transport; tests pass an in-memory one. */
  transport?: Transport;
  executor?: OpExecutor;
  /** Creates the browser substrate used by view, act, and read. */
  substrateFactory?: (session: SessionRecord) => Promise<FallbackSubstrate> | FallbackSubstrate;
  /** Browsers owned by sessions; closed with the server. */
  browsers?: BrowserRegistry;
  /** Idle time after which a session's browser is closed. Default 30 minutes. */
  sessionTtlMs?: number;
  /** How often idle sessions are swept. Default 60 seconds. */
  cleanupIntervalMs?: number;
  /** Write ledger. Defaults to the session store's SQLite ledger. */
  ledger?: WriteLedger;
  /** Persists fallback and explore traces as JSONL and HAR. */
  traceStore?: TraceStore;
  /** Tools for the mapping loop, so an MCP-only client can finish a map. */
  mapping?: MappingTools;
};

export type StdioServerHandle = {
  server: Awaited<ReturnType<typeof createMcpServer>>;
  sessions: SessionStore;
  close: () => Promise<void>;
};

/**
 * Start the MCP server over stdio.
 *
 * stdio is the one transport every MCP client supports, so this is the
 * install path for Claude Desktop, Codex CLI, and the rest. Nothing may be
 * written to stdout except protocol frames; logs go to stderr or a file.
 */
export async function startStdioServer(
  options: StdioServerOptions = {},
): Promise<StdioServerHandle> {
  const maps = new MapStore(options.mapsDir ?? process.env.MAPS_DIR ?? `${PORTOLAN_DIR}/maps`);
  const sessions = new SessionStore(
    options.databasePath ?? process.env.DATABASE_PATH ?? `${PORTOLAN_DIR}/state/portolan.db`,
  );
  const server = createMcpServer({
    maps,
    sessions,
    ledger: options.ledger ?? sessions.writeLedger(),
    ...(options.traceStore !== undefined ? { traceStore: options.traceStore } : {}),
    ...(options.mapping !== undefined ? { mapping: options.mapping } : {}),
    ...(options.executor !== undefined ? { executor: options.executor } : {}),
    ...(options.substrateFactory !== undefined
      ? { substrateFactory: options.substrateFactory }
      : {}),
    ...(options.browsers !== undefined
      ? { releaseSubstrate: (sid: string) => options.browsers?.close(sid) }
      : {}),
  });

  await server.connect(options.transport ?? new StdioServerTransport());

  // Nothing else ends a session whose agent has gone quiet, so its Chrome
  // would hold memory until the process exits.
  const sweep = setInterval(() => {
    const swept = sessions.sweepExpired(options.sessionTtlMs ?? 30 * 60 * 1000);
    void Promise.allSettled(swept.map((sid) => options.browsers?.close(sid)));
  }, options.cleanupIntervalMs ?? 60_000);
  sweep.unref();

  return {
    server,
    sessions,
    close: async () => {
      clearInterval(sweep);
      await server.close();
      await options.browsers?.closeAll();
      sessions.closeDatabase();
    },
  };
}
