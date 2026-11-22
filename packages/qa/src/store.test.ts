import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { caseContentSha, loadCases, parseCase, writeCaseFile } from "./spec.js";
import { QaStore } from "./store.js";

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

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-qa-store-"));
  const cases = join(root, "cases");
  const path = join(cases, "auth", "login.json");
  return { root, cases, path };
}

describe("QaStore", () => {
  it("migrates, reports its version, and passes integrity", () => {
    const store = new QaStore(":memory:");
    expect(store.schemaVersion()).toBe(1);
    expect(store.integrity()).toEqual({ ok: true, specDrift: [] });
    store.close();
  });

  it("rehydrates optional arrays from a minimal case file", () => {
    const space = workspace();
    mkdirSync(dirname(space.path), { recursive: true });
    writeFileSync(
      space.path,
      `${JSON.stringify({
        schema: 1,
        id: "auth/login",
        title: "Login",
        suite: "smoke",
        effect: "read",
        steps: [{ goto: "/sign-in" }],
      })}\n`,
      "utf8",
    );

    const store = new QaStore(join(space.root, "qa.db"));
    store.syncSpecs({ cases: loadCases(space.cases), suites: [] });

    // The repair and runner paths iterate these; a raw file omits them.
    const spec = store.getCase("auth/login")?.spec;
    expect(spec?.setup).toEqual([]);
    expect(spec?.expect).toEqual([]);
    expect(spec?.tags).toEqual([]);
    store.close();
  });

  it("does not trust a file-authored verified status on first import", () => {
    const space = workspace();
    const spec = parseCase(caseSpec());
    // Hand-write the forged claim, as an agent could: status verified and a
    // content hash that matches. The DB must still refuse to trust it.
    const forged = { ...spec, status: "verified", verifiedSha: caseContentSha(spec) };
    mkdirSync(dirname(space.path), { recursive: true });
    writeFileSync(space.path, `${JSON.stringify(forged, null, 2)}\n`, "utf8");

    const store = new QaStore(join(space.root, "qa.db"));
    store.syncSpecs({ cases: loadCases(space.cases), suites: [] });

    expect(store.getCase("auth/login")?.row.status).toBe("draft");
    store.close();
  });

  it("keeps verified only when the DB recorded it, and demotes on edit", () => {
    const space = workspace();
    const spec = parseCase(caseSpec());
    writeCaseFile(space.path, spec, { status: "draft" });

    const store = new QaStore(join(space.root, "qa.db"));
    store.syncSpecs({ cases: loadCases(space.cases), suites: [] });

    const loaded = loadCases(space.cases)[0];
    if (loaded === undefined) throw new Error("no case");

    // Only qa_verify calls putCase with verified.
    store.putCase(loaded, { status: "verified" });
    expect(store.getCase("auth/login")?.row.status).toBe("verified");
    expect(store.getCase("auth/login")?.row.verified_sha).toBe(caseContentSha(spec));

    // Removing the DB trust record demotes the case even if the file claims it.
    store.putCase(loaded, { status: "draft" });
    expect(store.getCase("auth/login")?.row.status).toBe("draft");

    // An edit is a new spec hash; the next sync demotes it.
    store.putCase(loaded, { status: "verified" });
    writeCaseFile(space.path, { ...spec, title: "Login v2" }, { status: "draft" });
    store.syncSpecs({ cases: loadCases(space.cases), suites: [] });
    expect(store.getCase("auth/login")?.row.status).toBe("draft");
    store.close();
  });

  it("marks a missing case orphaned instead of deleting history", () => {
    const space = workspace();
    const spec = parseCase(caseSpec());
    writeCaseFile(space.path, spec, { status: "draft" });

    const store = new QaStore(join(space.root, "qa.db"));
    store.syncSpecs({ cases: loadCases(space.cases), suites: [] });

    writeCaseFile(space.path, spec, { status: "draft" });
    const report = store.syncSpecs({ cases: [], suites: [] });
    expect(report.orphaned).toEqual(["auth/login"]);
    expect(store.getCase("auth/login")?.row.status).toBe("orphaned");
    store.close();
  });

  it("counts consecutive failures and quarantines after three", () => {
    const store = new QaStore(":memory:");

    store.recordFlake("auth/login", false);
    store.recordFlake("auth/login", false);
    expect(store.recordFlake("auth/login", false).quarantine).toBe(1);

    const afterPass = store.recordFlake("auth/login", true);
    expect(afterPass.consecutive_failures).toBe(0);
    expect(afterPass.quarantine).toBe(1);

    store.close();
  });

  it("records a run and computes its summary", () => {
    const store = new QaStore(":memory:");
    const run = store.startRun({ base_url: "http://127.0.0.1:3000", trigger: "manual" });
    store.recordCase(run.id, { case_id: "a", status: "pass", attempt: 1, duration_ms: 5 });
    store.recordCase(run.id, { case_id: "b", status: "fail", attempt: 1, fail_code: "not_found" });
    store.finishRun(run.id, "failed");

    const report = store.getRun(run.id);
    expect(report?.summary).toEqual({ pass: 1, fail: 1, skip: 0, error: 0 });
    expect(report?.run.status).toBe("failed");
    store.close();
  });
});
