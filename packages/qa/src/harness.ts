import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PORTOLAN_DIR } from "@abubakarsiddiik/protocol";

import {
  DEFAULT_QA_CONFIG,
  LEGACY_QA_CONFIG_FILE,
  QA_CONFIG_KEY,
  QA_CONFIG_PATH,
} from "./config.js";

export type HarnessName =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "gemini"
  | "vscode"
  | "unknown";

export type QaMcpCommand = {
  command: string;
  args: string[];
};

export type QaInitOptions = {
  /** Project root. Defaults to the working directory. */
  root?: string;
  baseUrl?: string;
  force?: boolean;
  /** Write or merge `.mcp.json` instead of only printing the snippet. */
  mcp?: boolean;
  /** How a harness should spawn the QA server. Defaults to the npx fallback. */
  mcpCommand?: QaMcpCommand;
};

export type QaInitResult = {
  /** The project root. */
  root: string;
  /** The `.portolan/` directory that was initialized. */
  dir: string;
  files: string[];
  skipped: string[];
  harnesses: HarnessName[];
  mcpSnippet: string;
  /** Path of the root `.mcp.json` the snippet belongs in. */
  mcpPath: string;
  mcpWritten: boolean;
};

/** The CLI is installed, so reuse it instead of fetching on every spawn. */
export const QA_MCP_CLI: QaMcpCommand = { command: "portolan", args: ["qa", "mcp"] };

/** Used only when the `portolan` CLI is not available. */
export const QA_MCP_NPX: QaMcpCommand = {
  command: "npx",
  args: ["-y", "-p", "@abubakarsiddiik/qa", "portolan-qa"],
};

type QaMcpServerEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type QaMcpEntry = {
  mcpServers: Record<string, QaMcpServerEntry>;
};

/** Backward-compatible npx snippet for the current working directory. */
export const MCP_SNIPPET = `${JSON.stringify(mcpEntry(QA_MCP_NPX, process.cwd()), null, 2)}\n`;

/**
 * Wire QA into a coding harness: config, dirs, skill, and the MCP snippet.
 *
 * Everything lives under `.portolan/`, which the root `.gitignore` ignores.
 * The root `.mcp.json` stays untouched unless
 * `mcp` is set, because Claude Code only reads project servers from the root.
 * It never overwrites a file without `force`.
 */
export function qaInit(options: QaInitOptions = {}): QaInitResult {
  const root = resolve(options.root ?? process.cwd());
  const portolanDir = join(root, PORTOLAN_DIR);
  const force = options.force ?? false;
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

  const configPath = join(root, QA_CONFIG_PATH);
  const configExists = existsSync(configPath);
  const config = readConfig(configExists ? configPath : join(root, LEGACY_QA_CONFIG_FILE));
  const existingQa =
    config[QA_CONFIG_KEY] !== null &&
    typeof config[QA_CONFIG_KEY] === "object" &&
    !Array.isArray(config[QA_CONFIG_KEY])
      ? (config[QA_CONFIG_KEY] as Record<string, unknown>)
      : {};

  const configuredBaseUrl = typeof existingQa.baseUrl === "string" ? existingQa.baseUrl : undefined;
  const baseUrl =
    force && options.baseUrl !== undefined
      ? options.baseUrl
      : (configuredBaseUrl ?? options.baseUrl ?? DEFAULT_QA_CONFIG.baseUrl);

  config[QA_CONFIG_KEY] = { ...existingQa, baseUrl };

  const configBody = `${JSON.stringify(config, null, 2)}\n`;
  const currentConfig = configExists ? readFileSync(configPath, "utf8") : undefined;
  if (currentConfig === configBody && !force) {
    skipped.push(configPath);
  } else {
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(configPath, configBody, "utf8");
    files.push(configPath);
  }

  mkdirSync(join(root, DEFAULT_QA_CONFIG.cases), { recursive: true });
  mkdirSync(join(root, DEFAULT_QA_CONFIG.suites), { recursive: true });

  writeIgnore(join(root, ".gitignore"), files);

  const skillPath = join(root, PORTOLAN_DIR, "skills", "portolan-qa", "SKILL.md");
  write(skillPath, QA_SKILL);

  const harnesses = detectHarnesses(root);

  const mcpPath = join(root, ".mcp.json");
  const command = options.mcpCommand ?? QA_MCP_NPX;
  const mcpSnippet = `${JSON.stringify(mcpEntry(command, root), null, 2)}\n`;
  let mcpWritten = false;

  if (options.mcp === true) {
    writeMcp(mcpPath, command, root, files);
    mcpWritten = true;
  }

  return {
    root,
    dir: portolanDir,
    files,
    skipped,
    harnesses,
    mcpSnippet,
    mcpPath,
    mcpWritten,
  };
}

export function detectHarnesses(root: string): HarnessName[] {
  const found: HarnessName[] = [];
  const has = (path: string): boolean => existsSync(join(root, path));

  if (has(".claude") || has("CLAUDE.md")) found.push("claude");
  if (has(".codex") || has("AGENTS.md")) found.push("codex");
  if (has(".cursor") || has(".cursorrules")) found.push("cursor");
  if (has("opencode.json") || has("opencode.jsonc") || has(".opencode")) found.push("opencode");
  if (has(".gemini") || has("GEMINI.md")) found.push("gemini");
  if (has(".vscode")) found.push("vscode");

  return found.length === 0 ? ["unknown"] : found;
}

function writeIgnore(path: string, files: string[]): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (
    existing
      .split("\n")
      .some((line) => line.trim() === `${PORTOLAN_DIR}/` || line.trim() === PORTOLAN_DIR)
  )
    return;

  const body = `${existing}${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}${PORTOLAN_DIR}/\n`;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
  files.push(path);
}

function writeMcp(path: string, command: QaMcpCommand, root: string, files: string[]): void {
  const entry = mcpEntry(command, root);
  const next = existsSync(path) ? mergeMcp(path, entry) : entry;

  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  files.push(path);
}

function mergeMcp(path: string, entry: QaMcpEntry): QaMcpEntry {
  const raw = readFileSync(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  const current = parsed as Record<string, unknown>;
  const servers =
    current.mcpServers !== null &&
    typeof current.mcpServers === "object" &&
    !Array.isArray(current.mcpServers)
      ? (current.mcpServers as Record<string, unknown>)
      : {};

  return {
    ...current,
    mcpServers: {
      ...servers,
      "portolan-qa": entry.mcpServers["portolan-qa"] as QaMcpServerEntry,
    },
  } as QaMcpEntry;
}

export function mcpEntry(command: QaMcpCommand, root: string): QaMcpEntry {
  return {
    mcpServers: {
      "portolan-qa": {
        command: command.command,
        args: command.args,
        env: {
          MAPS_DIR: join(root, PORTOLAN_DIR, "maps"),
          DATABASE_PATH: join(root, PORTOLAN_DIR, "state", "portolan.db"),
          TRACES_DIR: join(root, PORTOLAN_DIR, "state", "traces"),
          PORTOLAN_STORAGE_STATE: join(root, PORTOLAN_DIR, "state", "auth.json"),
          QA_CONFIG: join(root, QA_CONFIG_PATH),
        },
      },
    },
  };
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

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

export const QA_SKILL = `---
name: portolan-qa
description: Generate, run, and repair end-to-end tests against the local app with Portolan QA. Use after code changes, when the user asks to test a flow, or when a test fails. The runner is deterministic; you author and repair the cases.
---

# Portolan QA

The app under test is local. Cases are JSON files under
\`.portolan/qa/cases/\`. Runs and evidence live under \`.portolan/state/\`. You
are the test author; the runner replays what you write.

## The loop

1. After a change, call \`qa_plan\` with \`changed: true\`. It returns the cases
   the diff touches and any case that is not verified.
2. Run the selection with \`qa_run\`. Do not run the whole suite unless asked.
3. On a failure, call \`qa_result\` for the case. Read \`fail_code\`, the failed
   step, expected vs actual, and the evidence paths. Branch on the code:
   - \`assertion_failed\` — the app or the expectation is wrong.
   - \`not_found\`, \`stale_ref\`, \`not_interactive\` — the UI moved; call
     \`qa_repair\` with the case id. It replays to the failure, recovers the
     target by name similarity, rewrites the case as a draft, and confirms
     with one run. If it refuses, update the locator by hand.
   - \`harness_error\` — the app or browser is not ready; ask me to run
     \`portolan qa doctor\` (there is no \`qa_doctor\` MCP tool).
   - \`unknown_outcome\` — a write may have happened. Stop. Do not retry.
4. Fix the app or the case, then rerun the affected case.

## Tools

\`qa_list\`, \`qa_plan\`, \`qa_run\`, \`qa_status\`, \`qa_result\`,
\`qa_case_read\`, \`qa_case_write\`, \`qa_generate\`, \`qa_verify\`,
\`qa_repair\`, \`qa_coverage\`, \`qa_report\`. Doctor and sync are CLI-only
(\`portolan qa doctor\`, \`portolan qa sync\`).

## Authoring

- Write one case per file with \`qa_case_write\`. The id must match the path:
  \`auth/login\` lives in \`.portolan/qa/cases/auth/login.json\`.
- Or hand \`qa_generate\` a step list (\`from_spec\`) or a recorded trace file
  (\`from_trace\`); it fills id, suite, routes, and fixtures and writes a
  draft. Secret-looking fill values become \`\${env.QA_*}\` references — set
  them before running.
- Prefer semantic targets: \`{ role, name }\`, \`{ label }\`, or \`{ test_id }\`.
  Never use CSS selectors.
- Assert with \`expect\` checks: \`url\`, \`visible\`, \`absent\`, \`text\`, \`value\`.
- Reference fixtures as \`\${fixture.user.email}\` and secrets as
  \`\${env.QA_PASSWORD}\`. Never write a secret into a case.
- A new case is written as \`draft\`. Call \`qa_verify\` to replay it on fresh
  sessions; only then is it \`verified\`.
- Editing a verified case makes it a draft again. That is correct.

## Rules

- Never mark a case verified by editing its JSON. Use \`qa_verify\`.
- Never run unverified cases in CI without \`allow_unverified\`.
- Never retry a write whose result is \`unknown_outcome\`.
- Keep evidence out of git; \`.portolan/\` is ignored.
- If the diff selects nothing, say so and ask whether to run a suite.
`;
