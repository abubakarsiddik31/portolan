import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectHarnesses, qaInit } from "./harness.js";

describe("qaInit", () => {
  it("writes config, dirs, skill, and ignores only run artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    const result = qaInit({ root, baseUrl: "http://127.0.0.1:4000" });

    const config = JSON.parse(readFileSync(join(root, "portolan.config.json"), "utf8")) as {
      qa: { baseUrl: string };
    };
    expect(config.qa.baseUrl).toBe("http://127.0.0.1:4000");
    expect(existsSync(join(root, "qa", "cases"))).toBe(true);
    expect(existsSync(join(root, "skills", "portolan-qa", "SKILL.md"))).toBe(true);

    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain(".portolan/");
    expect(ignore.split("\n")).not.toContain("qa/");

    expect(result.harnesses).toEqual(["unknown"]);
    expect(result.mcpSnippet).toContain("@abubakarsiddiik/qa");
  });

  it("does not overwrite an existing config without force", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-init-"));
    qaInit({ root, baseUrl: "http://127.0.0.1:4000" });
    const second = qaInit({ root, baseUrl: "http://127.0.0.1:5000" });
    expect(second.skipped.some((path) => path.endsWith("portolan.config.json"))).toBe(true);
  });
});

describe("detectHarnesses", () => {
  it("reports unknown when nothing is detected", () => {
    expect(detectHarnesses(mkdtempSync(join(tmpdir(), "portolan-qa-detect-")))).toEqual([
      "unknown",
    ]);
  });
});
