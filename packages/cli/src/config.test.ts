import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "./commands/init.js";
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config.js";

const DOC = join(import.meta.dirname, "../../../docs/CONFIG.md");
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("config documentation", () => {
  it("documents every option, including the optional ones", () => {
    const doc = readFileSync(DOC, "utf8");
    const keys = [...Object.keys(DEFAULT_CONFIG), "baseUrl", "chrome"];

    for (const key of keys) {
      expect(doc, `docs/CONFIG.md is missing \`${key}\``).toContain(`\`${key}\``);
    }
  });

  it("init writes every default", () => {
    const dir = tempDir();
    runInit({ dir, site: "store" });

    const written = JSON.parse(readFileSync(join(dir, CONFIG_FILE), "utf8")) as Record<
      string,
      unknown
    >;

    expect(written.site).toBe("store");
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      if (key === "site") continue;
      expect(written[key], `init did not write "${key}"`).toEqual(value);
    }
  });
});

describe("mergeConfig", () => {
  it("accepts the lifecycle and logging options", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      sessionTtlMs: 1000,
      maxOpenSessions: 5,
      cleanupIntervalMs: 250,
      recoverSessions: false,
      headless: false,
      logLevel: "warn",
      chrome: "/opt/chrome",
      baseUrl: "https://example.test",
    });

    expect(merged).toMatchObject({
      sessionTtlMs: 1000,
      maxOpenSessions: 5,
      cleanupIntervalMs: 250,
      recoverSessions: false,
      headless: false,
      logLevel: "warn",
      chrome: "/opt/chrome",
      baseUrl: "https://example.test",
    });
  });

  it("rejects a non-boolean", () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { headless: "yes" })).toThrow(/boolean/);
  });

  it("rejects a non-positive interval", () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { sessionTtlMs: 0 })).toThrow(/integer >= 1/);
  });

  it("rejects an unknown log level", () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { logLevel: "verbose" })).toThrow(/logLevel/);
  });

  it("ignores an unknown key", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { futureOption: true });
    expect(merged).toEqual(DEFAULT_CONFIG);
  });
});

describe("loadConfig", () => {
  it("reads the new options from a file", () => {
    const dir = tempDir();
    const path = join(dir, CONFIG_FILE);
    mkdirSync(join(dir, ".portolan"), { recursive: true });
    writeFileSync(path, JSON.stringify({ site: "store", maxOpenSessions: 7, headless: false }));

    expect(loadConfig(path)).toMatchObject({ site: "store", maxOpenSessions: 7, headless: false });
  });

  it("treats an explicit config outside .portolan as a project config, not legacy", () => {
    const dir = tempDir();
    const custom = join(dir, "custom");
    mkdirSync(custom, { recursive: true });
    const path = join(custom, "config.json");
    writeFileSync(path, JSON.stringify({ site: "store" }));

    const loaded = loadConfig(path, { warn: false });

    expect(loaded.site).toBe("store");
    expect(loaded.database).toBe(join(custom, ".portolan/state/portolan.db"));
  });
});
