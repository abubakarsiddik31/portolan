import type { SessionRecord } from "@abubakarsiddiik/protocol";
import { readStorageState, sessionTransport } from "@abubakarsiddiik/runtime";
import type {
  ActivityFeed,
  BrowserRegistry,
  RuntimeExecutorOptions,
} from "@abubakarsiddiik/server";
import {
  BrowserHandle,
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
 * when `policies/<site>.json` exists. With an activity feed, the page is also
 * streamed to it as a screencast, so a person can watch the run.
 *
 * With a shared browser, each session opens its own window in that one Chrome
 * instead of launching another, and closing a session closes only its window.
 */
export function createBrowserFactory(
  config: CliConfig,
  browsers: BrowserRegistry,
  activity?: ActivityFeed,
  shared?: () => BrowserHandle | undefined,
): BrowserFactory | undefined {
  const executablePath = config.chrome ?? findChrome();
  if (executablePath === undefined) return undefined;

  const instanceId = process.env.PORTOLAN_INSTANCE_ID;
  const storageState = process.env.PORTOLAN_STORAGE_STATE ?? config.storageState;

  return async (session) => {
    const browser = shared?.();
    const engine = await PlaywrightEngine.launch({
      executablePath,
      headless: config.headless,
      ...(browser !== undefined ? { browser } : {}),
      ...(instanceId !== undefined ? { instanceId } : {}),
      ...(storageState !== undefined ? { storageState } : {}),
    });
    browsers.register(session.sid, engine);

    if (activity !== undefined) {
      const sid = session.sid;
      let shown = engine.url();
      activity.page(sid, "open", shown);
      const stop = await engine
        .screencast((frame) => activity.frame(sid, frame.data, frame.width, frame.height), {
          // A page that redirects or rewrites its history fires several
          // navigations to one URL; the timeline needs it once.
          onNavigate: (url) => {
            if (url === shown) return;
            shown = url;
            activity.page(sid, "navigated", url);
          },
        })
        .catch(() => async () => {});
      browsers.register(sid, {
        close: async () => {
          await stop();
          activity.page(sid, "closed");
          await engine.close();
        },
      });
    }

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

/**
 * Open the Chrome a person watches the run in.
 *
 * The window starts on the live view, so the timeline is there before the
 * agent does anything; each session then opens its own window beside it. The
 * browser stays up until the server closes. Returns undefined when Chrome is
 * missing.
 */
export async function openWatchBrowser(
  config: CliConfig,
  viewerUrl: string | undefined,
): Promise<BrowserHandle | undefined> {
  const executablePath = config.chrome ?? findChrome();
  if (executablePath === undefined) return undefined;

  const instanceId = process.env.PORTOLAN_INSTANCE_ID;
  const handle = await BrowserHandle.launch({
    executablePath,
    headless: false,
    ...(instanceId !== undefined ? { instanceId } : {}),
  });

  if (viewerUrl !== undefined) {
    try {
      const page = await handle.browser.newPage({ viewport: null });
      await page.goto(viewerUrl);
    } catch {
      // The viewer tab is a convenience; the agent's windows still open.
    }
  }
  return handle;
}
