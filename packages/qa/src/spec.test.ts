import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  caseContentSha,
  caseIdFromRelativePath,
  effectiveStatus,
  globMatches,
  loadCases,
  parseCase,
  writeCaseFile,
} from "./spec.js";

function caseSpec(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    id: "auth/login",
    title: "Login",
    suite: "smoke",
    effect: "read",
    status: "draft",
    tags: ["smoke"],
    touches: ["src/auth/**"],
    routes: ["/sign-in"],
    steps: [{ goto: "/sign-in" }],
    expect: [{ url: "/dashboard" }],
    ...overrides,
  };
}

describe("case spec", () => {
  it("parses a valid case and derives the id from the path", () => {
    const spec = parseCase(caseSpec(), "qa/cases/auth/login.json");
    expect(spec.id).toBe("auth/login");
    expect(spec.tags).toEqual(["smoke"]);
  });

  it("rejects a case whose id does not match its path", () => {
    expect(() => parseCase(caseSpec(), "qa/cases/auth/signup.json")).toThrow(/does not match/);
  });

  it("rejects a write case without a map", () => {
    expect(() => parseCase(caseSpec({ effect: "write" }))).toThrow(/needs a map/);
  });

  it("hashes content independently of key order and trust fields", () => {
    const a = parseCase(caseSpec());
    const b = parseCase({
      expect: [{ url: "/dashboard" }],
      steps: [{ goto: "/sign-in" }],
      routes: ["/sign-in"],
      touches: ["src/auth/**"],
      tags: ["smoke"],
      status: "verified",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      verifyRuns: 3,
      verifiedSha: "abc",
      effect: "read",
      suite: "smoke",
      title: "Login",
      id: "auth/login",
      schema: 1,
    });

    expect(caseContentSha(a)).toBe(caseContentSha(b));
  });

  it("treats a verified claim with a stale hash as a draft", () => {
    const spec = parseCase(caseSpec({ status: "verified", verifiedSha: "not-the-hash" }));
    expect(effectiveStatus(spec)).toBe("draft");
  });

  it("accepts a verified claim with a matching hash", () => {
    const base = parseCase(caseSpec());
    const spec = parseCase({
      ...base,
      status: "verified",
      verifiedSha: caseContentSha(base),
    });
    expect(effectiveStatus(spec)).toBe("verified");
  });

  it("matches globs for affected-case planning", () => {
    expect(globMatches("src/auth/**", "src/auth/login.ts")).toBe(true);
    expect(globMatches("src/**/login.ts", "src/features/auth/login.ts")).toBe(true);
    expect(globMatches("src/auth/*.ts", "src/auth/nested/login.ts")).toBe(false);
    expect(globMatches("**/*.tsx", "app/page.tsx")).toBe(true);
  });

  it("writes a verified case with a content hash and reads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "portolan-qa-spec-"));
    const path = join(dir, "auth", "login.json");
    writeCaseFile(path, parseCase(caseSpec()), { status: "verified", verifiedRuns: 3 });

    const [loaded] = loadCases(dir);
    expect(loaded).toBeDefined();
    expect(loaded?.spec.status).toBe("verified");
    expect(loaded?.spec.verifiedSha).toBe(caseContentSha(loaded?.spec as never));
    expect(loaded?.sha).toBe(
      createHash("sha256")
        .update(loaded?.text ?? "")
        .digest("hex"),
    );
  });

  it("derives ids with posix separators", () => {
    expect(caseIdFromRelativePath("auth\\login.json")).toBe("auth/login");
  });
});
