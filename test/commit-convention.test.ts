import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { beforeAll, describe, expect, it } from "vitest";

let rules: Awaited<ReturnType<typeof load>>["rules"];

beforeAll(async () => {
  const loaded = await load({}, { cwd: process.cwd() });
  rules = loaded.rules;
});

async function check(message: string): Promise<boolean> {
  const result = await lint(message, rules);
  return result.valid;
}

describe("commit message convention", () => {
  it("accepts a conventional lowercase subject", async () => {
    await expect(check("feat(runtime): add read-only state router")).resolves.toBe(true);
  });

  it("accepts a docs-only change", async () => {
    await expect(check("docs: explain map versioning")).resolves.toBe(true);
  });

  it("rejects a missing type", async () => {
    await expect(check("Added Router.")).resolves.toBe(false);
  });

  it("rejects an uppercase subject", async () => {
    await expect(check("feat: Add Router")).resolves.toBe(false);
  });

  it("rejects a trailing period", async () => {
    await expect(check("feat(runtime): add router.")).resolves.toBe(false);
  });

  it("rejects an uppercase scope", async () => {
    await expect(check("feat(Runtime): add router")).resolves.toBe(false);
  });

  it("rejects an over-long header", async () => {
    const header = `feat(runtime): ${"a".repeat(80)}`;
    await expect(check(header)).resolves.toBe(false);
  });
});
