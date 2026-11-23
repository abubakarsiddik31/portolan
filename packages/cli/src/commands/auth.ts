import { chmodSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { authStatePath, loginCommand, type QaEnvironment } from "@abubakarsiddiik/qa";
import { findChrome, PlaywrightEngine } from "@abubakarsiddiik/substrate";

export type AuthLoginInput = {
  /** The app's sign-in page. */
  url: string;
  /** Where to save the Playwright storage state. Default `.portolan/state/auth.json`. */
  out?: string;
  chrome?: string;
  /** How long to wait for the human to finish signing in. Default 5 minutes. */
  timeoutMs?: number;
  /**
   * Resolves when the person says they are signed in. A sign-in often passes
   * through an MFA or IdP page, so a URL change alone cannot tell; with this
   * set it replaces the URL heuristic.
   */
  confirm?: () => Promise<void>;
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

    if (input.confirm !== undefined) {
      await input.confirm();
    } else {
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
    }

    writeSessionFile(out, JSON.stringify(await engine.storageState(), null, 2));
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

/**
 * Write a session so it is never readable by anyone else, not even briefly:
 * the file is created 0600 in a 0700 directory and renamed into place, so a
 * reader sees the old session or the new one, never a partial write.
 */
function writeSessionFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${body}\n`, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

export type EnvLoginTarget = { url: string; out: string };

/** Where `auth login --env` signs in and saves, from the operator's config. */
export function resolveLoginTarget(
  environments: Record<string, QaEnvironment>,
  root: string,
  env: string,
  profile: string | undefined,
  home?: string,
): EnvLoginTarget {
  const found = environments[env];
  if (found === undefined) {
    const known = Object.keys(environments);
    throw new Error(
      known.length === 0
        ? 'no environments are configured; add "environments" to .portolan/config.json'
        : `no environment "${env}"; configured: ${known.join(", ")}`,
    );
  }

  const chosen = profile ?? (found.profiles.length === 1 ? found.profiles[0] : undefined);
  if (chosen === undefined) {
    throw new Error(`environment "${env}" needs --profile; one of: ${found.profiles.join(", ")}`);
  }
  if (!found.profiles.includes(chosen)) {
    throw new Error(
      `environment "${env}" has no profile "${chosen}"; one of: ${found.profiles.join(", ")}`,
    );
  }

  return { url: found.loginUrl ?? found.baseUrl, out: authStatePath(root, env, chosen, home) };
}

/** One line per environment profile: whether a session is saved and how old. */
export function authStatusLines(
  environments: Record<string, QaEnvironment>,
  root: string,
  now: () => number = Date.now,
  home?: string,
): string[] {
  const lines: string[] = [];
  for (const environment of Object.values(environments)) {
    for (const profile of environment.profiles) {
      const path = authStatePath(root, environment.name, profile, home);
      const label = `${environment.name}/${profile}`.padEnd(24);
      if (!existsSync(path)) {
        lines.push(`${label} no session   ${loginCommand(environment.name, profile)}`);
        continue;
      }
      const hours = Math.floor((now() - statSync(path).mtimeMs) / 3_600_000);
      lines.push(`${label} saved ${hours}h ago${environment.writes ? "   writes allowed" : ""}`);
    }
  }
  return lines;
}
