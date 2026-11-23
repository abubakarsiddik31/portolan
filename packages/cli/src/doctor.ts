import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { LEGACY_CONFIG, PORTOLAN_DIR } from "@abubakarsiddiik/protocol";
import { findChrome } from "@abubakarsiddiik/substrate";

export type CheckStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  name: "node" | "browser" | "config" | "providers" | "clients";
  status: CheckStatus;
  detail: string;
  /** What to do when the status is not ok. */
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};

export type DoctorDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
  home?: string;
  nodeVersion?: string;
  findChrome?: () => string | undefined;
  chromeVersion?: (path: string) => string | undefined;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
};

type ClientCandidate = {
  name: string;
  paths: (home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string[];
};

const PROVIDERS: Array<{ key: string; label: string }> = [
  { key: "ANTHROPIC_API_KEY", label: "anthropic" },
  { key: "OPENAI_API_KEY", label: "openai" },
  { key: "GEMINI_API_KEY", label: "gemini" },
  { key: "OLLAMA_HOST", label: "ollama" },
];

const CLIENTS: ClientCandidate[] = [
  {
    name: "claude-desktop",
    paths: (home, env, platform) =>
      platform === "darwin"
        ? [join(home, "Library/Application Support/Claude/claude_desktop_config.json")]
        : platform === "win32"
          ? [join(env.APPDATA ?? home, "Claude/claude_desktop_config.json")]
          : [join(home, ".config/Claude/claude_desktop_config.json")],
  },
  {
    name: "claude-code",
    paths: (home) => [join(home, ".claude.json"), join(home, ".claude/settings.json")],
  },
  { name: "cursor", paths: (home) => [join(home, ".cursor/mcp.json")] },
  {
    name: "vscode",
    paths: (home, env, platform) =>
      platform === "darwin"
        ? [join(home, "Library/Application Support/Code/User/mcp.json")]
        : platform === "win32"
          ? [join(env.APPDATA ?? home, "Code/User/mcp.json")]
          : [join(home, ".config/Code/User/mcp.json")],
  },
  { name: "gemini-cli", paths: (home) => [join(home, ".gemini/settings.json")] },
  { name: "codex", paths: (home) => [join(home, ".codex/config.toml")] },
];

/**
 * Diagnose the local install: the Node runtime, a browser, the config file,
 * model providers, and MCP clients.
 *
 * Every probe is injectable so the test suite never depends on the machine it
 * runs on. `doctor` reports what it found; it never changes a file.
 */
export function runDoctor(deps: DoctorDeps = {}): DoctorReport {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const home = deps.home ?? homedir();
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  const checks: DoctorCheck[] = [
    checkNode(deps.nodeVersion ?? process.version),
    checkBrowser(deps.findChrome ?? findChrome, deps.chromeVersion ?? chromeVersion),
    checkConfig(env, cwd, exists, readFile),
    checkProviders(env),
    checkClients(home, env, platform, exists, readFile),
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = ["portolan doctor", ""];

  for (const check of report.checks) {
    lines.push(`  ${check.status.padEnd(4)} ${check.name.padEnd(10)} ${check.detail}`);
    if (check.fix !== undefined && check.status !== "ok") {
      lines.push(`       ${" ".repeat(10)} → ${check.fix}`);
    }
  }

  const failures = report.checks.filter((check) => check.status === "fail").length;
  const warnings = report.checks.filter((check) => check.status === "warn").length;
  lines.push("");
  lines.push(
    failures === 0 && warnings === 0
      ? "all checks passed"
      : `${failures} failure${failures === 1 ? "" : "s"}, ${warnings} warning${
          warnings === 1 ? "" : "s"
        }`,
  );

  return lines.join("\n");
}

function checkNode(version: string): DoctorCheck {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  const enough = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 12);

  return enough
    ? { name: "node", status: "ok", detail: version }
    : {
        name: "node",
        status: "fail",
        detail: `${version} is older than the required 22.12`,
        fix: "install Node 22.12 or newer",
      };
}

function checkBrowser(
  find: () => string | undefined,
  version: (path: string) => string | undefined,
): DoctorCheck {
  const path = find();
  if (path === undefined) {
    return {
      name: "browser",
      status: "fail",
      detail: "no Chrome or Chromium found",
      fix: "install Google Chrome, or set CHROME_PATH to a Chromium binary",
    };
  }

  const reported = version(path);
  if (reported === undefined) {
    return {
      name: "browser",
      status: "warn",
      detail: `found ${path} but \`--version\` failed`,
      fix: "run the binary by hand; it may be a stub or the wrong architecture",
    };
  }

  return { name: "browser", status: "ok", detail: reported };
}

function checkConfig(
  env: NodeJS.ProcessEnv,
  cwd: string,
  exists: (path: string) => boolean,
  readFile: (path: string) => string,
): DoctorCheck {
  const current = join(cwd, PORTOLAN_DIR, "config.json");
  const legacy = join(cwd, LEGACY_CONFIG);
  const explicit = env.PORTOLAN_CONFIG;
  const path = explicit ?? (exists(current) ? current : exists(legacy) ? legacy : current);
  const isLegacy = basename(resolve(path)) === LEGACY_CONFIG;

  if (!exists(path)) {
    return {
      name: "config",
      status: "warn",
      detail: `no config file at ${path}; defaults are in use`,
      fix: `create ${join(PORTOLAN_DIR, "config.json")} (for example with portolan init) or set PORTOLAN_CONFIG`,
    };
  }

  try {
    const parsed = JSON.parse(readFile(path)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        name: "config",
        status: "fail",
        detail: `${path} is not a JSON object`,
        fix: "replace it with a JSON object",
      };
    }
  } catch (error) {
    return {
      name: "config",
      status: "fail",
      detail: `${path} is not valid JSON: ${(error as Error).message}`,
      fix: "fix the JSON or delete the file",
    };
  }

  if (isLegacy) {
    return {
      name: "config",
      status: "warn",
      detail: `${path} is legacy; expected ${join(PORTOLAN_DIR, "config.json")}`,
      fix: "run portolan migrate",
    };
  }

  return { name: "config", status: "ok", detail: path };
}

function checkProviders(env: NodeJS.ProcessEnv): DoctorCheck {
  const configured = PROVIDERS.filter(({ key }) => {
    const value = env[key];
    return value !== undefined && value.length > 0;
  }).map(({ label }) => label);

  if (configured.length === 0) {
    return {
      name: "providers",
      status: "warn",
      detail: "no model provider configured; compiled maps still run",
      fix: "set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_HOST",
    };
  }

  return { name: "providers", status: "ok", detail: `configured: ${configured.join(", ")}` };
}

function checkClients(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
  readFile: (path: string) => string,
): DoctorCheck {
  const found: string[] = [];
  const wired: string[] = [];

  for (const client of CLIENTS) {
    for (const path of client.paths(home, env, platform)) {
      if (!exists(path)) continue;
      found.push(client.name);

      try {
        if (readFile(path).toLowerCase().includes("portolan")) wired.push(client.name);
      } catch {
        // An unreadable client config is still a found client.
      }
      break;
    }
  }

  if (wired.length > 0) {
    return {
      name: "clients",
      status: "ok",
      detail: `portolan configured in: ${unique(wired).join(", ")}`,
    };
  }

  if (found.length > 0) {
    return {
      name: "clients",
      status: "warn",
      detail: `found ${unique(found).join(", ")} but no portolan server entry`,
      fix: "add the portolan MCP server to one client",
    };
  }

  return {
    name: "clients",
    status: "warn",
    detail: "no MCP client config found",
    fix: "install Claude Code, Cursor, VS Code, Gemini CLI, or Codex, then add portolan",
  };
}

function chromeVersion(path: string): string | undefined {
  try {
    const output = execFileSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
