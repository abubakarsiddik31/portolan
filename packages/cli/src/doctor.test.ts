import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatDoctor, runDoctor } from "./doctor.js";

const HOME = "/home/ada";
const CWD = "/work/site";
const CONFIG = join(CWD, ".portolan/config.json");
const CURSOR = join(HOME, ".cursor/mcp.json");
const CLAUDE = join(HOME, ".claude.json");

type Fixture = {
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  chrome?: string | undefined;
  nodeVersion?: string;
};

function doctor(fixture: Fixture = {}) {
  const files = fixture.files ?? {};
  return runDoctor({
    env: fixture.env ?? {},
    platform: "darwin",
    cwd: CWD,
    home: HOME,
    nodeVersion: fixture.nodeVersion ?? "v22.12.0",
    findChrome: () =>
      "chrome" in fixture
        ? fixture.chrome
        : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromeVersion: () => "Google Chrome 141.0.7390.55",
    exists: (path) => path in files,
    readFile: (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`no file: ${path}`);
      return value;
    },
  });
}

function status(report: ReturnType<typeof doctor>, name: string): string {
  return report.checks.find((check) => check.name === name)?.status ?? "missing";
}

describe("runDoctor", () => {
  it("passes when the browser, config, provider, and a client are ready", () => {
    const report = doctor({
      env: { ANTHROPIC_API_KEY: "sk-live" },
      files: {
        [CONFIG]: JSON.stringify({ database: "portolan.db" }),
        [CURSOR]: JSON.stringify({ mcpServers: { portolan: { command: "portolan" } } }),
      },
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "node",
      "browser",
      "config",
      "providers",
      "clients",
    ]);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("fails when no browser is found", () => {
    const report = doctor({ chrome: undefined });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "browser")).toMatchObject({
      status: "fail",
      fix: expect.stringContaining("CHROME_PATH"),
    });
  });

  it("fails on invalid config JSON", () => {
    const report = doctor({ files: { [CONFIG]: "{ nope" } });

    expect(status(report, "config")).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("warns when the config file is absent", () => {
    expect(status(doctor(), "config")).toBe("warn");
  });

  it("warns when only a legacy root config exists", () => {
    const report = doctor({ files: { [join(CWD, "portolan.config.json")]: "{}" } });
    const config = report.checks.find((check) => check.name === "config");

    expect(config).toMatchObject({ status: "warn", fix: "run portolan migrate" });
  });

  it("lists configured providers without printing their values", () => {
    const report = doctor({ env: { ANTHROPIC_API_KEY: "sk-secret", OLLAMA_HOST: "local" } });
    const providers = report.checks.find((check) => check.name === "providers");

    expect(providers?.status).toBe("ok");
    expect(providers?.detail).toBe("configured: anthropic, ollama");
    expect(JSON.stringify(report)).not.toContain("sk-secret");
  });

  it("warns when no provider is configured", () => {
    expect(status(doctor(), "providers")).toBe("warn");
  });

  it("warns when a client exists but does not mention portolan", () => {
    const report = doctor({
      files: { [CLAUDE]: JSON.stringify({ mcpServers: { other: {} } }) },
    });
    const clients = report.checks.find((check) => check.name === "clients");

    expect(clients).toMatchObject({ status: "warn" });
    expect(clients?.detail).toContain("claude-code");
  });

  it("warns when no client config exists", () => {
    expect(status(doctor(), "clients")).toBe("warn");
  });

  it("fails on an old node", () => {
    const report = doctor({ nodeVersion: "v20.11.0" });

    expect(status(report, "node")).toBe("fail");
    expect(report.ok).toBe(false);
  });
});

describe("formatDoctor", () => {
  it("prints one line per check and a summary", () => {
    const text = formatDoctor(
      doctor({
        env: { OPENAI_API_KEY: "sk-live" },
        files: {
          [CONFIG]: "{}",
          [CURSOR]: JSON.stringify({ portolan: {} }),
        },
      }),
    );

    expect(text).toContain("portolan doctor");
    expect(text).toContain("browser");
    expect(text).toContain("config");
    expect(text).toContain("providers");
    expect(text).toContain("clients");
    expect(text).toContain("all checks passed");
  });

  it("prints a fix for a failure", () => {
    const text = formatDoctor(doctor({ chrome: undefined }));

    expect(text).toContain("1 failure");
    expect(text).toContain("→");
  });
});
