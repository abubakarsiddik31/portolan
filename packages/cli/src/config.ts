import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { LEGACY_CONFIG, PORTOLAN_DIR } from "@abubakarsiddiik/protocol";

export type LogLevelName = "debug" | "info" | "warn" | "error";

export type SyncConfig = {
  /** Source globs to the state ids they affect, e.g. `{"src/admin/**": ["admin_*"]}`. */
  paths?: Record<string, string[]>;
  /** Read the route table from this framework's source to attribute route files. */
  routesFrom?: "react-router" | "next" | "sveltekit";
  /** The source directory, default `src`. */
  src?: string;
};

export type CliConfig = {
  /** The site name used by init, compile, and export-skills. */
  site: string;
  /** Directory of `maps/<site>/v<n>.json`. */
  maps: string;
  /** Directory for exported skills. */
  skills: string;
  /** Directory of `policies/<site>.json`. */
  policies: string;
  /** SQLite path, or `:memory:`. */
  database: string;
  /** Directory for recorded traces (JSONL + HAR). */
  traces: string;
  host: string;
  port: number;
  /** Optional base URL for a live site; compile and verify use it. */
  baseUrl?: string;
  /** Optional Chrome binary; otherwise CHROME_PATH or auto-detection. */
  chrome?: string;
  /** Playwright storage state for pages behind auth. */
  storageState?: string;
  /** Command that boots the app for discovery and verification. */
  start?: string;
  /** How `map sync` attributes changed files to the pages they affect. */
  sync?: SyncConfig;
  /** Run the browser headless. */
  headless: boolean;
  /** Idle time after which a session is closed. */
  sessionTtlMs: number;
  /** Maximum open sessions. */
  maxOpenSessions: number;
  /** How often the expiry sweep runs. */
  cleanupIntervalMs: number;
  /** Close sessions left open by a previous process at startup. */
  recoverSessions: boolean;
  /** Structured log level. */
  logLevel: LogLevelName;
};

export const DEFAULT_CONFIG: CliConfig = {
  site: "site",
  maps: `${PORTOLAN_DIR}/maps`,
  skills: `${PORTOLAN_DIR}/skills`,
  policies: `${PORTOLAN_DIR}/policies`,
  database: `${PORTOLAN_DIR}/state/portolan.db`,
  traces: `${PORTOLAN_DIR}/state/traces`,
  host: "127.0.0.1",
  port: 4200,
  headless: true,
  sessionTtlMs: 30 * 60 * 1000,
  maxOpenSessions: 100,
  cleanupIntervalMs: 60_000,
  recoverSessions: true,
  logLevel: "info",
};

/** Defaults for a legacy root `portolan.config.json`. */
const LEGACY_DEFAULT_CONFIG: CliConfig = {
  ...DEFAULT_CONFIG,
  maps: "maps",
  skills: "skills",
  policies: "policies",
  database: "portolan.db",
  traces: "traces",
};

/** Config path relative to the project root. */
export const CONFIG_FILE = `${PORTOLAN_DIR}/config.json`;

/** The pre-`.portolan/` config path, still read with a notice. */
export const LEGACY_CONFIG_FILE = LEGACY_CONFIG;

const LOG_LEVELS: LogLevelName[] = ["debug", "info", "warn", "error"];

export type LoadConfigOptions = {
  /** Receives the one-line legacy notice; pass `false` to stay silent. */
  warn?: ((line: string) => void) | false;
};

/**
 * Read `.portolan/config.json`, merged over the defaults.
 *
 * `.portolan/config.json` is tried first; a legacy root `portolan.config.json`
 * still loads with a one-line notice. An unknown key is ignored, not rejected:
 * the config is a starting point and a newer CLI should not fail on a field it
 * does not know yet. A missing file is the defaults; a malformed file throws
 * with its path. Relative paths resolve against the project root.
 */
export function loadConfig(path?: string, options: LoadConfigOptions = {}): CliConfig {
  const located = locateConfig(path);
  const file = located.file;
  const exists = existsSync(file);
  const root = projectRoot(file);
  const base = located.legacy ? LEGACY_DEFAULT_CONFIG : DEFAULT_CONFIG;

  if (!exists) return resolvePaths(base, root);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }

  if (located.legacy && options.warn !== false) {
    const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
    warn(
      `warning: ${file} is deprecated; move it to ${join(root, CONFIG_FILE)} (run portolan migrate)`,
    );
  }

  return resolvePaths(mergeConfig(base, parsed as Record<string, unknown>, file), root);
}

function locateConfig(path: string | undefined): { file: string; legacy: boolean } {
  const explicit = path ?? process.env.PORTOLAN_CONFIG;
  if (explicit !== undefined && explicit.length > 0) return classify(explicit);

  const current = join(process.cwd(), CONFIG_FILE);
  if (existsSync(current)) return { file: current, legacy: false };

  const legacy = join(process.cwd(), LEGACY_CONFIG_FILE);
  if (existsSync(legacy)) return { file: legacy, legacy: true };

  return { file: current, legacy: false };
}

function classify(file: string): { file: string; legacy: boolean } {
  return { file, legacy: basename(resolve(file)) === LEGACY_CONFIG_FILE };
}

/**
 * The project root for a config file.
 *
 * `.portolan/config.json` lives one level below the project; a legacy root
 * config, or an explicit path elsewhere, lives in the project directory itself.
 */
export function projectRoot(file: string): string {
  const dir = dirname(resolve(file));
  return basename(dir) === PORTOLAN_DIR ? dirname(dir) : dir;
}

function resolvePaths(config: CliConfig, root: string): CliConfig {
  const result: CliConfig = { ...config };

  for (const key of ["maps", "skills", "policies", "traces", "storageState"] as const) {
    const value = result[key];
    if (value !== undefined && !isAbsolute(value)) result[key] = resolve(root, value);
  }

  if (result.database !== ":memory:" && !isAbsolute(result.database)) {
    result.database = resolve(root, result.database);
  }

  return result;
}

export function mergeConfig(
  base: CliConfig,
  raw: Record<string, unknown>,
  source = "config",
): CliConfig {
  const result: CliConfig = { ...base };

  for (const key of [
    "site",
    "maps",
    "skills",
    "policies",
    "database",
    "traces",
    "host",
    "baseUrl",
    "chrome",
    "storageState",
    "start",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${source}: "${key}" must be a non-empty string`);
    }
    result[key] = value;
  }

  if (raw.sync !== undefined) {
    const sync = raw.sync as Record<string, unknown>;
    if (typeof sync !== "object" || sync === null || Array.isArray(sync)) {
      throw new Error(`${source}: "sync" must be an object`);
    }
    const paths = sync.paths as Record<string, unknown> | undefined;
    if (
      paths !== undefined &&
      (typeof paths !== "object" ||
        paths === null ||
        !Object.values(paths).every(
          (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
        ))
    ) {
      throw new Error(`${source}: "sync.paths" must map a glob to a list of state ids`);
    }
    result.sync = sync as SyncConfig;
  }

  for (const key of ["headless", "recoverSessions"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new Error(`${source}: "${key}" must be a boolean`);
    }
    result[key] = value;
  }

  for (const key of ["port", "sessionTtlMs", "maxOpenSessions", "cleanupIntervalMs"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    const minimum = key === "port" ? 0 : 1;
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
      throw new Error(`${source}: "${key}" must be an integer >= ${minimum}`);
    }
    result[key] = value;
  }

  if (raw.logLevel !== undefined) {
    if (!LOG_LEVELS.includes(raw.logLevel as LogLevelName)) {
      throw new Error(`${source}: "logLevel" must be one of ${LOG_LEVELS.join(", ")}`);
    }
    result.logLevel = raw.logLevel as LogLevelName;
  }

  return result;
}

export function configPath(dir = process.cwd()): string {
  return join(dir, CONFIG_FILE);
}
