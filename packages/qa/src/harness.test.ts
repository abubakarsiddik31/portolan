import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectHarnesses, QA_MCP_CLI, qaInit } from "./harness.js";

describe("qaInit", () => {
  it("writes everything under .portolan and leaves the root .gitignore alone", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    const result = qaInit({ root, baseUrl: "http://127.0.0.1:4000", mcpCommand: QA_MCP_CLI });

    const config = JSON.parse(readFileSync(join(root, ".portolan", "config.json"), "utf8")) as {
      qa: { baseUrl: string };
    };
    expect(config.qa.baseUrl).toBe("http://127.0.0.1:4000");
    expect(existsSync(join(root, ".portolan", "qa", "cases"))).toBe(true);
    expect(existsSync(join(root, ".portolan", "qa", "suites"))).toBe(true);
    expect(existsSync(join(root, ".portolan", "skills", "portolan-qa", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(root, ".portolan", ".gitignore"), "utf8")).toBe("state/\n");

    expect(existsSync(join(root, ".gitignore"))).toBe(false);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);

    expect(result.harnesses).toEqual(["unknown"]);
    expect(result.dir).toBe(join(root, ".portolan"));
    expect(result.mcpWritten).toBe(false);
    expect(result.mcpPath).toBe(join(root, ".mcp.json"));
    expect(result.mcpSnippet).toContain('"command": "portolan"');
    expect(result.mcpSnippet).toContain('"qa",');
    expect(result.mcpSnippet).toContain(join(root, ".portolan", "maps"));
    expect(result.mcpSnippet).toContain(join(root, ".portolan", "state", "portolan.db"));
    expect(result.mcpSnippet).toContain(join(root, ".portolan", "state", "traces"));
    expect(result.mcpSnippet).toContain(join(root, ".portolan", "state", "auth.json"));
  });

  it("writes .mcp.json only with --mcp and merges without dropping entries", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf8",
    );

    const result = qaInit({ root, mcp: true, mcpCommand: QA_MCP_CLI });

    expect(result.mcpWritten).toBe(true);
    const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(written.mcpServers.other?.command).toBe("other");
    expect(written.mcpServers["portolan-qa"]?.command).toBe("portolan");
  });

  it("does not overwrite an existing config without force", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    qaInit({ root, baseUrl: "http://127.0.0.1:4000" });
    const second = qaInit({ root, baseUrl: "http://127.0.0.1:5000" });
    expect(second.skipped.some((path) => path.endsWith(".portolan/config.json"))).toBe(true);

    const config = JSON.parse(readFileSync(join(root, ".portolan", "config.json"), "utf8")) as {
      qa: { baseUrl: string };
    };
    expect(config.qa.baseUrl).toBe("http://127.0.0.1:4000");
  });

  it("adds a qa block to a config created by portolan init", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    mkdirSync(join(root, ".portolan"), { recursive: true });
    writeFileSync(
      join(root, ".portolan", "config.json"),
      JSON.stringify({ site: "store", maps: ".portolan/maps" }),
      "utf8",
    );

    qaInit({ root, baseUrl: "http://127.0.0.1:4000" });

    const config = JSON.parse(readFileSync(join(root, ".portolan", "config.json"), "utf8")) as {
      site: string;
      qa: { baseUrl: string };
    };
    expect(config.site).toBe("store");
    expect(config.qa.baseUrl).toBe("http://127.0.0.1:4000");
  });

  it("adopts a legacy root config instead of dropping its qa settings", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    writeFileSync(
      join(root, "portolan.config.json"),
      JSON.stringify({ site: "legacy", qa: { baseUrl: "http://legacy", repeat: 2 } }),
      "utf8",
    );

    qaInit({ root });

    const config = JSON.parse(readFileSync(join(root, ".portolan", "config.json"), "utf8")) as {
      site: string;
      qa: { baseUrl: string; repeat: number };
    };
    expect(config.site).toBe("legacy");
    expect(config.qa.baseUrl).toBe("http://legacy");
    expect(config.qa.repeat).toBe(2);
  });

  it("appends state/ to an existing .portolan/.gitignore", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    mkdirSync(join(root, ".portolan"), { recursive: true });
    writeFileSync(join(root, ".portolan", ".gitignore"), "node_modules\n", "utf8");

    qaInit({ root });

    expect(readFileSync(join(root, ".portolan", ".gitignore"), "utf8")).toBe(
      "node_modules\nstate/\n",
    );
  });
});

describe("detectHarnesses", () => {
  it("reports unknown when nothing is detected", () => {
    expect(detectHarnesses(mkdtempSync(join(tmpdir(), "portolan-qa-detect-")))).toEqual([
      "unknown",
    ]);
  });
});
