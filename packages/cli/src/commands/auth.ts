import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { findChrome, PlaywrightEngine } from "@abubakarsiddiik/substrate";

export type AuthLoginInput = {
  /** The app's sign-in page. */
  url: string;
  /** Where to save the Playwright storage state. Default `.portolan/state/auth.json`. */
  out?: string;
  chrome?: string;
  /** How long to wait for the human to finish signing in. Default 5 minutes. */
  timeoutMs?: number;
};

export type AuthLoginDeps = {
  launch?: typeof PlaywrightEngine.launch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

export type AuthLoginResult = {
  out: string;
};

/**
 * Open a visible browser so a human can sign in, then save the session.
 *
 * Portolan never asks for a password: the user types it into the real page,
 * including MFA. The saved storage state is reused by `--storage-state` for
 * discovery, verification, and the MCP runtime.
 */
export async function runAuthLogin(
  input: AuthLoginInput,
  deps: AuthLoginDeps = {},
): Promise<AuthLoginResult> {
  const executablePath = input.chrome ?? findChrome();
  if (executablePath === undefined && deps.launch === undefined) {
    throw new Error("auth login needs Chrome; install it or set CHROME_PATH");
  }

  const out = resolve(input.out ?? join(".portolan", "state", "auth.json"));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const log = deps.log ?? (() => undefined);

  const engine = await (deps.launch ?? PlaywrightEngine.launch)({
    executablePath: executablePath ?? "chrome",
    headless: false,
  });

  try {
    const start = new URL(input.url);
    await engine.navigate(input.url);
    log(`sign in in the browser window; waiting for the URL to leave ${start.pathname}`);

    const deadline = now() + (input.timeoutMs ?? 5 * 60 * 1000);
    let current = engine.url();
    let left = current !== input.url && pathOf(current) !== start.pathname;

    while (!left && now() < deadline) {
      await sleep(500);
      current = engine.url();
      left = pathOf(current) !== start.pathname;
    }

    if (!left) {
      throw new Error(
        `timed out waiting for sign-in at ${input.url}; the page is still on ${start.pathname}`,
      );
    }

    mkdirSync(dirname(out), { recursive: true });
    await engine.storageState(out);
    chmodSync(out, 0o600);
    log(`saved storage state to ${out}`);

    return { out };
  } finally {
    await engine.close();
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
