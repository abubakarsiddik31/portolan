import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { LEGACY_CONFIG, PORTOLAN_DIR } from "@abubakarsiddiik/protocol";

export type EvidenceMode = "failures" | "all" | "none";

export type QaConfig = {
  /** Project root. Paths below are absolute after loading. */
  root: string;
  /** The app under test. */
  baseUrl: string;
  /** SQLite database path, or ":memory:". */
  database: string;
  /** Directory of case JSON files. */
  cases: string;
  /** Directory of suite JSON files. */
  suites: string;
  /** Directory of run artifacts. */
  runs: string;
  /** Fixture file, relative to root. */
  fixtures: string;
  /** Directory of `maps/<site>/v<n>.json`, for cases that call map ops. */
  maps: string;
  /** Git ref used by `qa plan --changed`. */
  baseRef: string;
  /** Replays for a normal run (flake detection). */
  repeat: number;
  /** Replays required before a case is verified. */
  verifyRepeat: number;
  timeoutMs: number;
  headless: boolean;
  evidence: EvidenceMode;
  maxCases: number;
  allowUnverified: boolean;
  /** Capture a viewport screenshot with evidence. Off: it cannot be redacted. */
  screenshot: boolean;
  /** Substrings redacted from evidence and stored values. */
  redact: string[];
  chrome?: string;
};

type QaDefaults = Omit<QaConfig, "root">;

export const QA_CONFIG_KEY = "qa";

/** File name inside the Portolan directory. */
export const QA_CONFIG_FILE = "config.json";

/** Config path relative to the project root. */
export const QA_CONFIG_PATH = `${PORTOLAN_DIR}/${QA_CONFIG_FILE}`;

/** The pre-`.portolan/` config file, still read with a notice. */
export const LEGACY_QA_CONFIG_FILE = LEGACY_CONFIG;

const SHARED_QA_DEFAULTS: Omit<
  QaDefaults,
  "database" | "cases" | "suites" | "runs" | "fixtures" | "maps"
> = {
  baseUrl: "http://127.0.0.1:3000",
  baseRef: "origin/main",
  repeat: 1,
  verifyRepeat: 3,
  timeoutMs: 15_000,
  headless: true,
  evidence: "failures",
  maxCases: 50,
  allowUnverified: false,
  screenshot: false,
  redact: ["password", "token", "secret", "authorization", "cookie"],
};

/** Defaults for `.portolan/config.json`; paths are relative to the project root. */
export const DEFAULT_QA_CONFIG: QaDefaults = {
  ...SHARED_QA_DEFAULTS,
  database: `${PORTOLAN_DIR}/state/qa.db`,
  cases: `${PORTOLAN_DIR}/qa/cases`,
  suites: `${PORTOLAN_DIR}/qa/suites`,
  runs: `${PORTOLAN_DIR}/state/qa/runs`,
  fixtures: `${PORTOLAN_DIR}/qa/fixtures.json`,
  maps: `${PORTOLAN_DIR}/maps`,
};

/** Defaults for a legacy root `portolan.config.json`. */
const LEGACY_DEFAULT_QA_CONFIG: QaDefaults = {
  ...SHARED_QA_DEFAULTS,
  database: ".portolan/qa.db",
  cases: "qa/cases",
  suites: "qa/suites",
  runs: ".portolan/qa/runs",
  fixtures: "qa/fixtures.json",
  maps: "maps",
};

export type LoadedQaConfig = {
  config: QaConfig;
  /** The config file that was read, when one existed. */
  file?: string;
  /** True when the file existed but had no `qa` block. */
  missingBlock: boolean;
  /** Set when a legacy root config was used instead of `.portolan/config.json`. */
  legacy?: {
    file: string;
    replacement: string;
  };
};

export type LoadQaConfigOptions = {
  /** Receives the one-line legacy notice; pass `false` to stay silent. */
  warn?: ((line: string) => void) | false;
};

/**
 * Read the `qa` block from `.portolan/config.json`, merged over the defaults.
 *
 * `.portolan/config.json` is tried first; a legacy root `portolan.config.json`
 * still loads with a one-line notice. `--config`, `QA_CONFIG`, and
 * `PORTOLAN_CONFIG` keep precedence. A missing file is the defaults; a
 * malformed file throws with its path.
 */
export function loadQaConfig(
  path?: string,
  env: NodeJS.ProcessEnv = process.env,
  options: LoadQaConfigOptions = {},
): LoadedQaConfig {
  const located = locateConfig(path, env);
  const file = located.file;
  const exists = existsSync(file);
  const root = projectRoot(file);
  const defaults = located.legacy ? LEGACY_DEFAULT_QA_CONFIG : DEFAULT_QA_CONFIG;

  let raw: Record<string, unknown> = {};
  let missingBlock = true;

  if (exists) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${file} must contain a JSON object`);
    }

    const block = (parsed as Record<string, unknown>)[QA_CONFIG_KEY];
    if (block !== undefined) {
      if (block === null || typeof block !== "object" || Array.isArray(block)) {
        throw new Error(`${file}: "${QA_CONFIG_KEY}" must be an object`);
      }
      raw = block as Record<string, unknown>;
      missingBlock = false;
    }
  }

  if (located.legacy && exists && options.warn !== false) {
    const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
    warn(legacyNotice(file, root));
  }

  return {
    config: mergeQaConfig(root, raw, file, env, defaults),
    ...(exists ? { file } : {}),
    missingBlock,
    ...(located.legacy && exists
      ? { legacy: { file, replacement: join(root, PORTOLAN_DIR, QA_CONFIG_FILE) } }
      : {}),
  };
}

function locateConfig(
  path: string | undefined,
  env: NodeJS.ProcessEnv,
): { file: string; legacy: boolean } {
  const explicit = path ?? env.QA_CONFIG ?? env.PORTOLAN_CONFIG;
  if (explicit !== undefined && explicit.length > 0) return classify(explicit);

  const current = join(process.cwd(), PORTOLAN_DIR, QA_CONFIG_FILE);
  if (existsSync(current)) return { file: current, legacy: false };

  const legacy = join(process.cwd(), LEGACY_QA_CONFIG_FILE);
  if (existsSync(legacy)) return { file: legacy, legacy: true };

  return { file: current, legacy: false };
}

function classify(file: string): { file: string; legacy: boolean } {
  return { file, legacy: basename(resolve(file)) === LEGACY_QA_CONFIG_FILE };
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

function legacyNotice(file: string, root: string): string {
  return `warning: ${file} is deprecated; move it to ${join(root, PORTOLAN_DIR, QA_CONFIG_FILE)} (run portolan migrate)`;
}

export function mergeQaConfig(
  root: string,
  raw: Record<string, unknown>,
  source = "qa config",
  env: NodeJS.ProcessEnv = process.env,
  defaults: QaDefaults = DEFAULT_QA_CONFIG,
): QaConfig {
  const result: QaConfig = {
    ...defaults,
    root,
    database: absolute(root, defaults.database),
    cases: absolute(root, defaults.cases),
    suites: absolute(root, defaults.suites),
    runs: absolute(root, defaults.runs),
    fixtures: absolute(root, defaults.fixtures),
    maps: absolute(root, defaults.maps),
  };

  for (const key of [
    "baseUrl",
    "database",
    "cases",
    "suites",
    "runs",
    "fixtures",
    "maps",
    "baseRef",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${source}: "${key}" must be a non-empty string`);
    }
    result[key] = key === "baseUrl" || key === "baseRef" ? value : absolute(root, value);
  }

  for (const key of ["repeat", "verifyRepeat", "timeoutMs", "maxCases"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new Error(`${source}: "${key}" must be an integer >= 1`);
    }
    result[key] = value;
  }

  for (const key of ["headless", "allowUnverified", "screenshot"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new Error(`${source}: "${key}" must be a boolean`);
    }
    result[key] = value;
  }

  if (raw.evidence !== undefined) {
    if (raw.evidence !== "failures" && raw.evidence !== "all" && raw.evidence !== "none") {
      throw new Error(`${source}: "evidence" must be failures, all, or none`);
    }
    result.evidence = raw.evidence;
  }

  if (raw.redact !== undefined) {
    if (!Array.isArray(raw.redact) || raw.redact.some((item) => typeof item !== "string")) {
      throw new Error(`${source}: "redact" must be an array of strings`);
    }
    result.redact = raw.redact as string[];
  }

  if (raw.chrome !== undefined) {
    if (typeof raw.chrome !== "string" || raw.chrome.length === 0) {
      throw new Error(`${source}: "chrome" must be a non-empty string`);
    }
    result.chrome = raw.chrome;
  }

  if (raw.database === ":memory:") {
    result.database = ":memory:";
  }

  if (env.QA_BASE_URL !== undefined && env.QA_BASE_URL.length > 0) {
    result.baseUrl = env.QA_BASE_URL;
  }

  if (env.QA_DATABASE !== undefined && env.QA_DATABASE.length > 0) {
    result.database = env.QA_DATABASE === ":memory:" ? ":memory:" : absolute(root, env.QA_DATABASE);
  }

  return result;
}

export function absolute(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}
