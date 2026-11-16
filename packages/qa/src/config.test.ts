import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadQaConfig } from "./config.js";

describe("loadQaConfig", () => {
  it("uses defaults when the file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const loaded = loadQaConfig(join(root, "missing.json"), {});
    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:3000");
    expect(loaded.config.database).toBe(join(process.cwd(), ".portolan/qa.db"));
    expect(loaded.missingBlock).toBe(true);
  });

  it("reads the qa block without the CLI's flat-key loader", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const path = join(root, "portolan.config.json");
    writeFileSync(
      path,
      JSON.stringify({ site: "app", qa: { baseUrl: "http://127.0.0.1:4321", repeat: 2 } }),
      "utf8",
    );

    const loaded = loadQaConfig(path, {});
    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:4321");
    expect(loaded.config.repeat).toBe(2);
    expect(loaded.config.cases).toBe(join(root, "qa/cases"));
    expect(loaded.missingBlock).toBe(false);
  });

  it("lets QA_BASE_URL and QA_DATABASE override the file", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const path = join(root, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ qa: { baseUrl: "http://127.0.0.1:3000" } }), "utf8");

    const loaded = loadQaConfig(path, {
      QA_BASE_URL: "http://127.0.0.1:9999",
      QA_DATABASE: ":memory:",
    });
    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:9999");
    expect(loaded.config.database).toBe(":memory:");
  });

  it("rejects an invalid qa block", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const path = join(root, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ qa: { repeat: 0 } }), "utf8");
    expect(() => loadQaConfig(path, {})).toThrow(/repeat/);
  });
});
