import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevelName = "debug" | "info" | "warn" | "error";

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
  host: string;
  port: number;
  /** Optional base URL for a live site; compile and verify use it. */
  baseUrl?: string;
  /** Optional Chrome binary; otherwise CHROME_PATH or auto-detection. */
  chrome?: string;
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
  maps: "maps",
  skills: "skills",
  policies: "policies",
  database: "portolan.db",
  host: "127.0.0.1",
  port: 4200,
  headless: true,
  sessionTtlMs: 30 * 60 * 1000,
  maxOpenSessions: 100,
  cleanupIntervalMs: 60_000,
  recoverSessions: true,
  logLevel: "info",
};

export const CONFIG_FILE = "portolan.config.json";

const LOG_LEVELS: LogLevelName[] = ["debug", "info", "warn", "error"];

/**
 * Read `portolan.config.json`, merged over the defaults.
 *
 * An unknown key is ignored, not rejected: the config is a starting point and
 * a newer CLI should not fail on a field it does not know yet. A missing file
 * is the defaults; a malformed file throws with its path.
 */
export function loadConfig(path?: string): CliConfig {
  const file = path ?? process.env.PORTOLAN_CONFIG ?? CONFIG_FILE;
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }

  return mergeConfig(DEFAULT_CONFIG, parsed as Record<string, unknown>, file);
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
    "host",
    "baseUrl",
    "chrome",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${source}: "${key}" must be a non-empty string`);
    }
    result[key] = value;
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
