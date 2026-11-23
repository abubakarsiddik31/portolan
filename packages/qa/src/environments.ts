import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { QaError } from "./errors.js";

/**
 * A named target the agent can run against: dev, qa, prod.
 *
 * Environments are operator-owned config. The agent picks one by name and a
 * profile by name; it never sees a credential, a session path, or a cookie.
 */
export type QaEnvironment = {
  name: string;
  baseUrl: string;
  /** `baseUrl`'s origin. Navigation and secret fills are held to it. */
  origin: string;
  /** Sign-in page for `auth login`; defaults to `baseUrl`. */
  loginUrl?: string;
  /** Account roles with a saved session, e.g. `admin`, `member`. */
  profiles: string[];
  /**
   * Whether cases with a `write` or `irreversible` effect may run. Default
   * false: an environment is read-only until an operator says otherwise.
   */
  writes: boolean;
};

/** One resolved run target: an environment and the session it runs as. */
export type RunEnvironment = {
  name: string;
  profile: string;
  baseUrl: string;
  origin: string;
  writes: boolean;
  /** Playwright storage state for this profile. Never returned to a client. */
  storageState: string;
};

export type EnvironmentSelection = {
  env?: string | undefined;
  as?: string | undefined;
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KEYS = new Set(["baseUrl", "loginUrl", "profiles", "writes"]);

/**
 * Parse the top-level `environments` block, failing closed.
 *
 * An unknown key or a wrongly typed `writes` is an error, not a default: a
 * typo such as `"write": false` must not leave a prod environment writable.
 */
export function parseEnvironments(raw: unknown, source = "config"): Record<string, QaEnvironment> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: "environments" must be an object`);
  }

  const result: Record<string, QaEnvironment> = {};

  for (const [name, value] of Object.entries(raw)) {
    const at = `${source}: environments.${name}`;
    if (!NAME.test(name)) throw new Error(`${at} is not a valid environment name`);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${at} must be an object`);
    }

    const entry = value as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!KEYS.has(key)) throw new Error(`${at}: unknown key "${key}"`);
    }

    const baseUrl = httpUrl(entry.baseUrl, `${at}.baseUrl`);
    const loginUrl =
      entry.loginUrl === undefined ? undefined : httpUrl(entry.loginUrl, `${at}.loginUrl`);

    if (
      !Array.isArray(entry.profiles) ||
      entry.profiles.length === 0 ||
      entry.profiles.some((item) => typeof item !== "string" || !NAME.test(item))
    ) {
      throw new Error(`${at}.profiles must be a non-empty array of profile names`);
    }
    const profiles = entry.profiles as string[];
    if (new Set(profiles).size !== profiles.length) {
      throw new Error(`${at}.profiles must not repeat a profile`);
    }

    if (entry.writes !== undefined && typeof entry.writes !== "boolean") {
      throw new Error(`${at}.writes must be true or false`);
    }

    result[name] = {
      name,
      baseUrl,
      origin: new URL(baseUrl).origin,
      ...(loginUrl !== undefined ? { loginUrl } : {}),
      profiles,
      writes: entry.writes === true,
    };
  }

  return result;
}

function httpUrl(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${at} must be a non-empty URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${at} is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${at} must be an http or https URL`);
  }
  return value;
}

/**
 * Where a profile's session lives.
 *
 * It is outside the repository on purpose: a session holds post-sign-in
 * cookies, so it must not be committed, and an agent confined to the project
 * directory cannot read it. `PORTOLAN_HOME` overrides `~/.portolan`.
 */
export function authStatePath(
  root: string,
  env: string,
  profile: string,
  home: string = process.env.PORTOLAN_HOME ?? join(homedir(), ".portolan"),
): string {
  const label = basename(root).replace(/[^A-Za-z0-9._-]+/g, "_");
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(home, "sessions", `${label}-${hash}`, env, `${profile}.json`);
}

export function loginCommand(env: string, profile: string): string {
  return `portolan auth login --env ${env} --profile ${profile}`;
}

/**
 * Turn `{ env, as }` into a run target, or throw a typed error the agent can
 * act on. Asking for no environment returns `undefined`: the legacy
 * single-`baseUrl` behaviour.
 */
export function resolveEnvironment(
  environments: Record<string, QaEnvironment>,
  selection: EnvironmentSelection,
  options: { root: string; home?: string; env?: NodeJS.ProcessEnv },
): RunEnvironment | undefined {
  if (selection.env === undefined) {
    if (selection.as !== undefined) {
      throw new QaError("invalid_request", '"as" needs an "env"');
    }
    return undefined;
  }

  const known = Object.keys(environments);
  const found = Object.hasOwn(environments, selection.env)
    ? environments[selection.env]
    : undefined;
  if (found === undefined) {
    throw new QaError(
      "not_found",
      known.length === 0
        ? `no environments are configured; add "environments" to .portolan/config.json`
        : `no environment "${selection.env}"`,
      { environments: known },
    );
  }

  const override = (options.env ?? process.env).QA_BASE_URL;
  if (override !== undefined && override.length > 0) {
    throw new QaError(
      "invalid_request",
      "QA_BASE_URL is set and would point an environment run at another host; unset it",
    );
  }

  let profile = selection.as;
  if (profile === undefined) {
    const only = found.profiles.length === 1 ? found.profiles[0] : undefined;
    if (only === undefined) {
      throw new QaError("invalid_request", `environment "${found.name}" needs "as"`, {
        profiles: found.profiles,
      });
    }
    profile = only;
  } else if (!found.profiles.includes(profile)) {
    throw new QaError("not_found", `environment "${found.name}" has no profile "${profile}"`, {
      profiles: found.profiles,
    });
  }

  const storageState = authStatePath(options.root, found.name, profile, options.home);
  if (!existsSync(storageState)) {
    throw new QaError(
      "auth_missing",
      `no saved session for ${found.name}/${profile}; a person must sign in once`,
      { next: [loginCommand(found.name, profile)] },
    );
  }

  return {
    name: found.name,
    profile,
    baseUrl: found.baseUrl,
    origin: found.origin,
    writes: found.writes,
    storageState,
  };
}
