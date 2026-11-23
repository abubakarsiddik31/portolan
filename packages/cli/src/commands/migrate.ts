import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { PORTOLAN_DIR } from "@abubakarsiddiik/protocol";
import { mcpEntry, QA_MCP_CLI } from "@abubakarsiddiik/qa";

export type MigrateOptions = {
  /** Project root. Defaults to the working directory. */
  root?: string;
};

export type MigrateMove = {
  from: string;
  to: string;
};

export type MigrateResult = {
  root: string;
  dir: string;
  moved: MigrateMove[];
  /** Files rewritten in place, such as a root `.mcp.json` entry. */
  updated: string[];
};

/**
 * Move a legacy root layout into `.portolan/`.
 *
 * The plan is checked before anything moves: if a destination already exists,
 * the command refuses and leaves every file in place. The config file is
 * rewritten so paths that named the old defaults keep pointing at the moved
 * files; the QA database moves too, so verified cases stay verified.
 */
export function runMigrate(options: MigrateOptions = {}): MigrateResult {
  const root = options.root ?? process.cwd();
  const dir = join(root, PORTOLAN_DIR);

  // State moves run first: `.portolan/qa` (legacy run evidence) has to vacate
  // `.portolan/qa` before the root `qa/` directory can move into its place.
  const plan: MigrateMove[] = [
    { from: join(root, PORTOLAN_DIR, "qa.db"), to: join(dir, "state", "qa.db") },
    { from: join(root, PORTOLAN_DIR, "qa"), to: join(dir, "state", "qa") },
    { from: join(root, PORTOLAN_DIR, "traces"), to: join(dir, "state", "traces") },
    { from: join(root, "portolan", "auth.json"), to: join(dir, "state", "auth.json") },
    { from: join(root, "portolan.config.json"), to: join(dir, "config.json") },
    { from: join(root, "qa"), to: join(dir, "qa") },
    { from: join(root, "maps"), to: join(dir, "maps") },
    { from: join(root, "policies"), to: join(dir, "policies") },
    { from: join(root, "portolan.db"), to: join(dir, "state", "portolan.db") },
    ...skillMoves(root, dir),
  ];

  const present = plan.filter((item) => item.from !== item.to && existsSync(item.from));
  const conflicts: MigrateMove[] = [];
  const vacated = new Set<string>();

  for (const item of present) {
    if (existsSync(item.to) && !vacated.has(item.to)) conflicts.push(item);
    vacated.add(item.from);
  }

  if (conflicts.length > 0) {
    const list = conflicts.map((item) => `  ${item.to}`).join("\n");
    throw new Error(`refusing to overwrite existing files:\n${list}`);
  }

  const moved: MigrateMove[] = [];

  for (const item of present) {
    mkdirSync(join(item.to, ".."), { recursive: true });
    if (item.to === join(dir, "config.json")) {
      writeMigratedConfig(item.from, item.to);
    } else {
      renameSync(item.from, item.to);
    }
    moved.push(item);
  }

  const updated: string[] = [];

  if (moved.length > 0) {
    ensureNestedIgnore(dir);
    cleanRootIgnore(root);
    const mcp = refreshMcpEntry(root);
    if (mcp !== undefined) updated.push(mcp);
  }

  return { root, dir, moved, updated };
}

/**
 * Point an existing root `.mcp.json` `portolan-qa` entry at `portolan qa mcp`
 * with absolute `.portolan/` paths. Other servers and an unrelated file are
 * left untouched.
 */
function refreshMcpEntry(root: string): string | undefined {
  const path = join(root, ".mcp.json");
  if (!existsSync(path)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const current = parsed as Record<string, unknown>;
  const servers = current.mcpServers;
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) return undefined;

  const entries = servers as Record<string, unknown>;
  if (!("portolan-qa" in entries)) return undefined;

  const entry = mcpEntry(QA_MCP_CLI, root);
  const body = `${JSON.stringify(
    {
      ...current,
      mcpServers: { ...entries, "portolan-qa": entry.mcpServers["portolan-qa"] },
    },
    null,
    2,
  )}\n`;

  if (readFileSync(path, "utf8") === body) return undefined;
  writeFileSync(path, body, "utf8");
  return path;
}

function ensureNestedIgnore(dir: string): void {
  const path = join(dir, ".gitignore");
  if (existsSync(path)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, "state/\n", "utf8");
}

function cleanRootIgnore(root: string): void {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return;

  const body = readFileSync(path, "utf8");
  const lines = body.split("\n");
  const kept = lines.filter((line) => {
    const value = line.trim();
    return value !== ".portolan/" && value !== ".portolan";
  });

  if (kept.length === lines.length) return;
  writeFileSync(path, kept.join("\n"), "utf8");
}

function skillMoves(root: string, dir: string): MigrateMove[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];

  return readdirSync(skills)
    .filter((name) => name === "portolan" || name.startsWith("portolan-"))
    .map((name) => ({ from: join(skills, name), to: join(dir, "skills", name) }));
}

function writeMigratedConfig(from: string, to: string): void {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(from, "utf8"));
  } catch {
    renameSync(from, to);
    return;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    renameSync(from, to);
    return;
  }

  const rewritten = rewriteConfig(parsed as Record<string, unknown>);
  writeFileSync(to, `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
  rmSync(from);
}

function rewriteConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };

  remap(next, "maps", "maps");
  remap(next, "skills", "skills");
  remap(next, "policies", "policies");
  remap(next, "traces", "traces");
  remap(next, "database", "portolan.db", `${PORTOLAN_DIR}/state/portolan.db`);
  remap(next, "storageState", "portolan/auth.json", `${PORTOLAN_DIR}/state/auth.json`);

  const qa = next.qa;
  if (qa !== null && typeof qa === "object" && !Array.isArray(qa)) {
    const block = { ...(qa as Record<string, unknown>) };
    remap(block, "cases", "qa/cases", `${PORTOLAN_DIR}/qa/cases`);
    remap(block, "suites", "qa/suites", `${PORTOLAN_DIR}/qa/suites`);
    remap(block, "fixtures", "qa/fixtures.json", `${PORTOLAN_DIR}/qa/fixtures.json`);
    remap(block, "maps", "maps", `${PORTOLAN_DIR}/maps`);
    remap(block, "database", ".portolan/qa.db", `${PORTOLAN_DIR}/state/qa.db`);
    remap(block, "runs", ".portolan/qa/runs", `${PORTOLAN_DIR}/state/qa/runs`);
    next.qa = block;
  }

  return next;
}

function remap(record: Record<string, unknown>, key: string, from: string, to?: string): void {
  const value = record[key];
  if (value !== from) return;
  record[key] = to ?? `${PORTOLAN_DIR}/${from}`;
}
