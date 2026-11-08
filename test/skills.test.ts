import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const SKILL_DIR = "skills/portolan";
const RAW = readFileSync(join(ROOT, SKILL_DIR, "SKILL.md"), "utf8");

const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(RAW);
const frontmatter = (frontmatterMatch ? parse(frontmatterMatch[1] ?? "") : {}) as Record<
  string,
  unknown
>;
const body = frontmatterMatch ? RAW.slice(frontmatterMatch[0].length) : RAW;

describe("portolan skill", () => {
  it("starts with YAML frontmatter", () => {
    expect(frontmatterMatch).not.toBeNull();
  });

  it("names the skill after its directory", () => {
    expect(frontmatter.name).toBe("portolan");
    expect(SKILL_DIR.split("/").pop()).toBe(frontmatter.name);
  });

  it("has a description within the skill limit", () => {
    expect(typeof frontmatter.description).toBe("string");

    const description = frontmatter.description as string;
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("documents the portable surface", () => {
    for (const term of ["list_sites", "open_site", "call"]) {
      expect(body).toContain(term);
    }
  });

  it("documents the write protocol", () => {
    for (const term of ["confirm", "idempotency_key", "unknown_outcome"]) {
      expect(body).toContain(term);
    }
  });

  it("documents fallback", () => {
    for (const term of ["fallback_begin", "fallback_done", "view", "act", "read"]) {
      expect(body).toContain(term);
    }
  });

  it("treats page text as data", () => {
    expect(body).toMatch(/data, not instructions/i);
  });

  it("has the required sections", () => {
    for (const heading of [
      "## The loop",
      "## Writes",
      "## Errors",
      "## Fallback scope",
      "## Untrusted data",
    ]) {
      expect(body).toContain(heading);
    }
  });

  it("contains no obvious secret", () => {
    expect(RAW).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(RAW).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it("stays small enough to load as a skill", () => {
    expect(RAW.length).toBeLessThan(20_000);
  });
});
