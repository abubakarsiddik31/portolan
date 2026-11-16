import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_QA_CONFIG, QA_CONFIG_FILE, QA_CONFIG_KEY } from "./config.js";

export type HarnessName =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "gemini"
  | "vscode"
  | "unknown";

export type QaInitOptions = {
  root: string;
  baseUrl?: string;
  force?: boolean;
};

export type QaInitResult = {
  root: string;
  files: string[];
  skipped: string[];
  harnesses: HarnessName[];
  mcpSnippet: string;
};

const MCP_SNIPPET = `${JSON.stringify(
  {
    mcpServers: {
      "portolan-qa": {
        command: "npx",
        args: ["-y", "-p", "@portolan/qa", "portolan-qa"],
      },
    },
  },
  null,
  2,
)}\n`;

/**
 * Wire QA into a coding harness: config, dirs, skill, ignore rules, and the
 * MCP entry. It never overwrites a file without `force`.
 */
export function qaInit(options: QaInitOptions): QaInitResult {
  const root = options.root;
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

  const configPath = join(root, QA_CONFIG_FILE);
  const config = readConfig(configPath);
  const existingQa =
    config[QA_CONFIG_KEY] !== null &&
    typeof config[QA_CONFIG_KEY] === "object" &&
    !Array.isArray(config[QA_CONFIG_KEY])
      ? (config[QA_CONFIG_KEY] as Record<string, unknown>)
      : {};

  config[QA_CONFIG_KEY] = {
    ...existingQa,
    baseUrl:
      options.baseUrl ??
      (typeof existingQa.baseUrl === "string" ? existingQa.baseUrl : DEFAULT_QA_CONFIG.baseUrl),
  };

  write(configPath, `${JSON.stringify(config, null, 2)}\n`);

  mkdirSync(join(root, DEFAULT_QA_CONFIG.cases), { recursive: true });
  mkdirSync(join(root, DEFAULT_QA_CONFIG.suites), { recursive: true });

  const skillPath = join(root, "skills", "portolan-qa", "SKILL.md");
  write(skillPath, QA_SKILL);

  const harnesses = detectHarnesses(root);

  if (harnesses.includes("claude")) {
    write(join(root, ".mcp.json"), MCP_SNIPPET);
  }

  const ignorePath = join(root, ".gitignore");
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (!ignore.split("\n").some((line) => line.trim() === ".portolan/")) {
    if (ignore.length > 0 && !ignore.endsWith("\n")) appendFileSync(ignorePath, "\n", "utf8");
    appendFileSync(ignorePath, ".portolan/\n", "utf8");
    files.push(ignorePath);
  }

  return { root, files, skipped, harnesses, mcpSnippet: MCP_SNIPPET };
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

The app under test is local. Cases are JSON files under \`qa/cases/\`. Runs and
evidence live under \`.portolan/\`. You are the test author; the runner replays
what you write.

## The loop

1. After a change, call \`qa_plan\` with \`changed: true\`. It returns the cases
   the diff touches and any case that is not verified.
2. Run the selection with \`qa_run\`. Do not run the whole suite unless asked.
3. On a failure, call \`qa_result\` for the case. Read \`fail_code\`, the failed
   step, expected vs actual, and the evidence paths. Branch on the code:
   - \`assertion_failed\` — the app or the expectation is wrong.
   - \`not_found\`, \`stale_ref\`, \`not_interactive\` — the UI moved; repair the
     locator, then verify.
   - \`harness_error\` — the app or browser is not ready; call \`qa_doctor\`.
   - \`unknown_outcome\` — a write may have happened. Stop. Do not retry.
4. Fix the app or the case, then rerun the affected case.

## Authoring

- Write one case per file with \`qa_case_write\`. The id must match the path:
  \`auth/login\` lives in \`qa/cases/auth/login.json\`.
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

export { MCP_SNIPPET };
