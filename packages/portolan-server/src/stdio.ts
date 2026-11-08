import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { OpExecutor } from "./executor.js";
import { MapStore } from "./maps.js";
import { createMcpServer } from "./mcp.js";
import { SessionStore } from "./store.js";

export type StdioServerOptions = {
  /** Directory of `maps/<site>/v<n>.json`. Default `MAPS_DIR` or `maps`. */
  mapsDir?: string;
  /** SQLite path. Default `DATABASE_PATH` or `portolan.db`. */
  databasePath?: string;
  /** Defaults to a stdio transport; tests pass an in-memory one. */
  transport?: Transport;
  executor?: OpExecutor;
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
  const maps = new MapStore(options.mapsDir ?? process.env.MAPS_DIR ?? "maps");
  const sessions = new SessionStore(
    options.databasePath ?? process.env.DATABASE_PATH ?? "portolan.db",
  );
  const server = createMcpServer({
    maps,
    sessions,
    ...(options.executor !== undefined ? { executor: options.executor } : {}),
  });

  await server.connect(options.transport ?? new StdioServerTransport());

  return {
    server,
    sessions,
    close: async () => {
      await server.close();
      sessions.closeDatabase();
    },
  };
}
