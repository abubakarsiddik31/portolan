import type { SessionRecord } from "@abubakarsiddiik/protocol";
import { readStorageState, sessionTransport } from "@abubakarsiddiik/runtime";
import type { BrowserRegistry, RuntimeExecutorOptions } from "@abubakarsiddiik/server";
import {
  EgressGuard,
  findChrome,
  loadPolicy,
  PlaywrightEngine,
  Substrate,
} from "@abubakarsiddiik/substrate";

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

/**
 * Serve `http` ops from the saved session, with no browser.
 *
 * The session file is read on every call, so a fresh `auth login` is picked up
 * without a restart. The site's egress policy applies exactly as it does in a
 * page. Absent a saved session this returns undefined and ops use a browser.
 */
export function createPageless(config: CliConfig): RuntimeExecutorOptions["pageless"] {
  const path = process.env.PORTOLAN_STORAGE_STATE ?? config.storageState;
  if (path === undefined) return undefined;

  return ({ map, baseUrl }) => {
    const state = readStorageState(path);
    if (state === undefined) return undefined;

    const policy = loadPolicy(map.site, config.policies);
    const guard = policy === undefined ? undefined : new EgressGuard(policy);

    return sessionTransport({
      state,
      pageOrigin: new URL(baseUrl).origin,
      ...(guard !== undefined
        ? { guard: (url: string, method: string) => guard.checkResolved(url, method) }
        : {}),
    });
  };
}
