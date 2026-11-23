import { TraceStore } from "@abubakarsiddiik/runtime";
import {
  BrowserRegistry,
  type StdioServerHandle,
  type StdioServerOptions,
  startStdioServer,
} from "@abubakarsiddiik/server";

import { createBrowserFactory } from "../browser.js";
import type { CliConfig } from "../config.js";
import { createMappingTools } from "./mapping.js";

export type McpInput = {
  config: CliConfig;
};

export type McpDeps = {
  start?: (options: StdioServerOptions) => Promise<StdioServerHandle>;
  /** Override the browser factory; tests pass a fake. */
  substrateFactory?: StdioServerOptions["substrateFactory"];
};

/**
 * Start the MCP server over stdio for a client that spawns this process.
 *
 * stdout belongs to the protocol, so this command prints nothing. A browser is
 * launched lazily, on the first view/act/read, and closed with the server.
 */
export async function runMcp(input: McpInput, deps: McpDeps = {}): Promise<StdioServerHandle> {
  const browsers = new BrowserRegistry();
  const factory = deps.substrateFactory ?? createBrowserFactory(input.config, browsers);
  const start = deps.start ?? startStdioServer;

  return start({
    mapsDir: process.env.MAPS_DIR ?? input.config.maps,
    databasePath: process.env.DATABASE_PATH ?? input.config.database,
    traceStore: new TraceStore(process.env.TRACES_DIR ?? input.config.traces),
    browsers,
    sessionTtlMs: input.config.sessionTtlMs,
    cleanupIntervalMs: input.config.cleanupIntervalMs,
    ...(factory !== undefined ? { substrateFactory: factory } : {}),
    mapping: createMappingTools(input.config),
  });
}
