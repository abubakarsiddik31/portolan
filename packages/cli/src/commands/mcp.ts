import { TraceStore } from "@abubakarsiddiik/runtime";
import {
  ActivityFeed,
  BrowserRegistry,
  DEFAULT_WATCH_PORT,
  type StdioServerHandle,
  type StdioServerOptions,
  startStdioServer,
  startWatchServer,
  type WatchServerHandle,
} from "@abubakarsiddiik/server";

import type { BrowserHandle } from "@abubakarsiddiik/substrate";

import { createBrowserFactory, createPageless, openWatchBrowser } from "../browser.js";
import type { CliConfig } from "../config.js";
import { createMappingTools } from "./mapping.js";

export type McpInput = {
  config: CliConfig;
  /**
   * Serve a live view of the run on this port: the browser page and every
   * tool call. 0 picks a free port. Off when undefined.
   */
  watchPort?: number;
};

export type McpDeps = {
  start?: (options: StdioServerOptions) => Promise<StdioServerHandle>;
  /** Override the watch server; tests pass a fake. */
  watch?: typeof startWatchServer;
  /** Where the watch URL is announced. stdout is the protocol, so default stderr. */
  announce?: (line: string) => void;
  /** Override the browser factory; tests pass a fake. */
  substrateFactory?: StdioServerOptions["substrateFactory"];
  /** Override the visible watch browser; tests pass a fake. */
  watchBrowser?: typeof openWatchBrowser;
};

/**
 * Start the MCP server over stdio for a client that spawns this process.
 *
 * stdout belongs to the protocol, so this command prints nothing there. A
 * browser is launched lazily, on the first view/act/read, and closed with the
 * server. With `watchPort`, a local page shows the run live and its URL goes
 * to stderr. When the browser is not headless, watching also opens one
 * visible Chrome at startup, on the live view, and every session's window
 * opens in it; it stays open until the server closes.
 */
export async function runMcp(input: McpInput, deps: McpDeps = {}): Promise<StdioServerHandle> {
  const browsers = new BrowserRegistry();
  const activity = input.watchPort !== undefined ? new ActivityFeed() : undefined;
  let shared: BrowserHandle | undefined;
  const factory =
    deps.substrateFactory ?? createBrowserFactory(input.config, browsers, activity, () => shared);
  const pageless = createPageless(input.config);
  const start = deps.start ?? startStdioServer;

  const announce = deps.announce ?? ((line: string) => process.stderr.write(`${line}\n`));
  let watcher: WatchServerHandle | undefined;
  if (activity !== undefined) {
    // Watching is for a person; a port clash must not stop the agent's server.
    try {
      watcher = await (deps.watch ?? startWatchServer)({
        feed: activity,
        port: input.watchPort ?? DEFAULT_WATCH_PORT,
      });
      announce(`portolan: watch the agent at ${watcher.url}`);
    } catch (error) {
      announce(`portolan: watch server not started: ${(error as Error).message}`);
    }

    if (!input.config.headless) {
      try {
        shared = await (deps.watchBrowser ?? openWatchBrowser)(input.config, watcher?.url);
        if (shared === undefined)
          announce("portolan: Chrome not found; no browser window to watch");
      } catch (error) {
        announce(`portolan: watch browser not opened: ${(error as Error).message}`);
      }
    }
  }

  const handle = await start({
    mapsDir: process.env.MAPS_DIR ?? input.config.maps,
    databasePath: process.env.DATABASE_PATH ?? input.config.database,
    traceStore: new TraceStore(process.env.TRACES_DIR ?? input.config.traces),
    browsers,
    sessionTtlMs: input.config.sessionTtlMs,
    cleanupIntervalMs: input.config.cleanupIntervalMs,
    ...(factory !== undefined ? { substrateFactory: factory } : {}),
    ...(pageless !== undefined ? { pageless } : {}),
    mapping: createMappingTools(input.config),
    ...(activity !== undefined ? { activity } : {}),
  });

  if (watcher === undefined && shared === undefined) return handle;
  const stopWatching = watcher;
  const window = shared;
  return {
    ...handle,
    close: async () => {
      await handle.close();
      await window?.close();
      await stopWatching?.close();
    },
  };
}

/**
 * The watch port from `--watch`, `--watch-port`, or `PORTOLAN_WATCH`.
 *
 * `PORTOLAN_WATCH` is for MCP client configs, where an env entry is easier to
 * add than an argument: `1` or `true` uses the default port, a number picks
 * one, and `0`, `false`, or empty leaves watching off.
 */
export function watchPortFrom(
  flag: boolean,
  port: number | undefined,
  env: string | undefined,
): number | undefined {
  if (port !== undefined) return port;
  if (flag) return DEFAULT_WATCH_PORT;

  const value = env?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "0" || value === "false") return undefined;
  if (value === "1" || value === "true") return DEFAULT_WATCH_PORT;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORTOLAN_WATCH must be 1, true, or a port number, not "${env}"`);
  }
  return parsed;
}
