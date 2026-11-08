import type { SessionRecord } from "@portolan/protocol";
import {
  BrowserRegistry,
  type StdioServerHandle,
  type StdioServerOptions,
  startStdioServer,
} from "@portolan/server";
import { findChrome, loadPolicy, PlaywrightEngine, Substrate } from "@portolan/substrate";

import type { CliConfig } from "../config.js";

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
  const factory = deps.substrateFactory ?? browserFactory(input.config, browsers);
  const start = deps.start ?? startStdioServer;

  return start({
    mapsDir: process.env.MAPS_DIR ?? input.config.maps,
    databasePath: process.env.DATABASE_PATH ?? input.config.database,
    browsers,
    ...(factory !== undefined ? { substrateFactory: factory } : {}),
  });
}

function browserFactory(
  config: CliConfig,
  browsers: BrowserRegistry,
): StdioServerOptions["substrateFactory"] {
  const executablePath = config.chrome ?? findChrome();
  if (executablePath === undefined) return undefined;

  const instanceId = process.env.PORTOLAN_INSTANCE_ID;

  return async (session: SessionRecord) => {
    const engine = await PlaywrightEngine.launch({
      executablePath,
      headless: config.headless,
      ...(instanceId !== undefined ? { instanceId } : {}),
    });
    browsers.register(session.sid, engine);

    const policy =
      session.site === undefined ? undefined : loadPolicy(session.site, config.policies);
    return new Substrate(engine, policy !== undefined ? { policy } : {});
  };
}
