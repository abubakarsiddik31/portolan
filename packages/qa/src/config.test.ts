import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadQaConfig } from "./config.js";

describe("loadQaConfig", () => {
  it("uses defaults when the file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const loaded = loadQaConfig(join(root, "missing.json"), {});
    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:3000");
    expect(loaded.config.database).toBe(join(root, ".portolan/state/qa.db"));
    expect(loaded.missingBlock).toBe(true);
    expect(loaded.legacy).toBeUndefined();
  });

  it("treats an explicit config outside .portolan as a project config, not legacy", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const custom = join(root, "custom");
    mkdirSync(custom, { recursive: true });
    const path = join(custom, "config.json");
    writeFileSync(path, JSON.stringify({ qa: { baseUrl: "http://127.0.0.1:4321" } }), "utf8");

    const loaded = loadQaConfig(path, {}, { warn: false });

    expect(loaded.legacy).toBeUndefined();
    expect(loaded.config.root).toBe(custom);
    expect(loaded.config.cases).toBe(join(custom, ".portolan/qa/cases"));
  });

  it("defaults every path under .portolan for the current layout", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    mkdirSync(join(root, ".portolan"), { recursive: true });
    const path = join(root, ".portolan", "config.json");
    writeFileSync(path, JSON.stringify({ qa: { baseUrl: "http://127.0.0.1:4321" } }), "utf8");

    const loaded = loadQaConfig(path, {});

    expect(loaded.config.root).toBe(root);
    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:4321");
    expect(loaded.config.cases).toBe(join(root, ".portolan/qa/cases"));
    expect(loaded.config.suites).toBe(join(root, ".portolan/qa/suites"));
    expect(loaded.config.fixtures).toBe(join(root, ".portolan/qa/fixtures.json"));
    expect(loaded.config.maps).toBe(join(root, ".portolan/maps"));
    expect(loaded.config.database).toBe(join(root, ".portolan/state/qa.db"));
    expect(loaded.config.runs).toBe(join(root, ".portolan/state/qa/runs"));
    expect(loaded.legacy).toBeUndefined();
  });

  it("reads a legacy root config and announces the replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const path = join(root, "portolan.config.json");
    writeFileSync(
      path,
      JSON.stringify({ site: "app", qa: { baseUrl: "http://127.0.0.1:4321", repeat: 2 } }),
      "utf8",
    );

    const warnings: string[] = [];
    const loaded = loadQaConfig(path, {}, { warn: (line) => void warnings.push(line) });

    expect(loaded.config.baseUrl).toBe("http://127.0.0.1:4321");
    expect(loaded.config.repeat).toBe(2);
    expect(loaded.config.cases).toBe(join(root, "qa/cases"));
    expect(loaded.missingBlock).toBe(false);
    expect(loaded.legacy).toEqual({
      file: path,
      replacement: join(root, ".portolan", "config.json"),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(".portolan/config.json");
  });

  it("stays silent when warn is false", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-config-"));
    const path = join(root, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ qa: {} }), "utf8");

    expect(() => loadQaConfig(path, {}, { warn: false })).not.toThrow();
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
    expect(() => loadQaConfig(path, {}, { warn: false })).toThrow(/repeat/);
  });
});
