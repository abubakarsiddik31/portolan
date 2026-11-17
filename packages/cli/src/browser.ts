import type { SessionRecord } from "@abubakarsiddiik/protocol";
import type { BrowserRegistry } from "@abubakarsiddiik/server";
import { findChrome, loadPolicy, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";

import type { CliConfig } from "./config.js";

export type BrowserFactory = (session: SessionRecord) => Promise<Substrate>;

/**
 * Build the browser factory shared by `serve` and `mcp`.
 *
 * The browser is launched on the first fallback verb, registered so it can be
 * closed with the server or the session, and given the site's egress policy
 * when `policies/<site>.json` exists.
 */
export function createBrowserFactory(
  config: CliConfig,
  browsers: BrowserRegistry,
): BrowserFactory | undefined {
  const executablePath = config.chrome ?? findChrome();
  if (executablePath === undefined) return undefined;

  const instanceId = process.env.PORTOLAN_INSTANCE_ID;
  const storageState = process.env.PORTOLAN_STORAGE_STATE ?? config.storageState;

  return async (session) => {
    const engine = await PlaywrightEngine.launch({
      executablePath,
      headless: config.headless,
      ...(instanceId !== undefined ? { instanceId } : {}),
      ...(storageState !== undefined ? { storageState } : {}),
    });
    browsers.register(session.sid, engine);

    const policy =
      session.site === undefined ? undefined : loadPolicy(session.site, config.policies);

    return new Substrate(engine, policy !== undefined ? { policy } : {});
  };
}
