import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PORTOLAN_DIR } from "@abubakarsiddiik/protocol";

import {
  type CliConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  LEGACY_CONFIG_FILE,
  mergeConfig,
} from "../config.js";
import { MAP_SKILL, USAGE_SKILL } from "../skills.js";

export type InitOptions = {
  /** Project root. Defaults to the working directory. */
  dir?: string;
  site?: string;
  force?: boolean;
};

export type InitResult = {
  /** The project root. */
  root: string;
  /** The `.portolan/` directory that was initialized. */
  dir: string;
  config: CliConfig;
  files: string[];
  skipped: string[];
};

/**
 * Write `.portolan/config.json`, a map directory, a policy, and the skills.
 *
 * `dir` is the project root; every file lands under `<root>/.portolan/`.
 * Existing files are never overwritten without `force`, so a second `init`
 * in a configured project is a no-op rather than a reset. The config is
 * merged rather than replaced, so `qa init` and `init` can run in either
 * order without dropping each other's settings.
 */
export function runInit(options: InitOptions = {}): InitResult {
  const root = options.dir ?? process.cwd();
  const portolanDir = join(root, PORTOLAN_DIR);
  const force = options.force ?? false;

  const configPath = join(root, CONFIG_FILE);
  const legacyPath = join(root, LEGACY_CONFIG_FILE);
  const existing = existsSync(configPath)
    ? readObject(configPath)
    : existsSync(legacyPath)
      ? readObject(legacyPath)
      : {};

  const base: CliConfig = {
    ...DEFAULT_CONFIG,
    ...(options.site !== undefined ? { site: options.site } : {}),
  };
  const merged = mergeConfig(base, existing);
  const config = {
    ...existing,
    ...merged,
    ...(options.site !== undefined ? { site: options.site } : {}),
  } as CliConfig;

  const site = config.site;
  const files: string[] = [];
  const skipped: string[] = [];

  const write = (path: string, body: string): void => {
    if (existsSync(path) && !force) {
      skipped.push(path);
      return;
    }
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body, "utf8");
    files.push(path);
  };

  const configBody = `${JSON.stringify(config, null, 2)}\n`;
  const currentConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  if (currentConfig === configBody && !force) {
    skipped.push(configPath);
  } else {
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(configPath, configBody, "utf8");
    files.push(configPath);
  }

  writeIgnore(join(root, PORTOLAN_DIR, ".gitignore"), files, skipped);
  write(
    join(root, config.policies, `${site}.json`),
    `${JSON.stringify({ site, allow: [] }, null, 2)}\n`,
  );

  mkdirSync(join(root, config.maps, site), { recursive: true });
  mkdirSync(join(root, config.skills), { recursive: true });

  write(join(root, config.skills, "portolan-map", "SKILL.md"), MAP_SKILL);
  write(join(root, config.skills, "portolan", "SKILL.md"), USAGE_SKILL);

  return { root, dir: portolanDir, config, files, skipped };
}

function writeIgnore(path: string, files: string[], skipped: string[]): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === "state/")) {
    skipped.push(path);
    return;
  }

  const body = `${existing}${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}state/\n`;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
  files.push(path);
}

function readObject(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return parsed as Record<string, unknown>;
}
