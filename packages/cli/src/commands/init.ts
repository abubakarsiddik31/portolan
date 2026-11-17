import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type CliConfig, CONFIG_FILE, DEFAULT_CONFIG } from "../config.js";
import { MAP_SKILL, USAGE_SKILL } from "../skills.js";

export type InitOptions = {
  dir?: string;
  site?: string;
  force?: boolean;
};

export type InitResult = {
  dir: string;
  config: CliConfig;
  files: string[];
  skipped: string[];
};

/**
 * Write a starting config, a map directory, a policy, and a skills directory.
 *
 * Existing files are never overwritten without `force`, so a second `init`
 * in a configured project is a no-op rather than a reset.
 */
export function runInit(options: InitOptions = {}): InitResult {
  const dir = options.dir ?? process.cwd();
  const site = options.site ?? DEFAULT_CONFIG.site;
  const force = options.force ?? false;

  const config: CliConfig = { ...DEFAULT_CONFIG, site };
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

  write(join(dir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
  write(
    join(dir, config.policies, `${site}.json`),
    `${JSON.stringify({ site, allow: [] }, null, 2)}\n`,
  );

  mkdirSync(join(dir, config.maps, site), { recursive: true });
  mkdirSync(join(dir, config.skills), { recursive: true });

  write(join(dir, config.skills, "portolan-map", "SKILL.md"), MAP_SKILL);
  write(join(dir, config.skills, "portolan", "SKILL.md"), USAGE_SKILL);

  return { dir, config, files, skipped };
}
