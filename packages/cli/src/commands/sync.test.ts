import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { VerifyReport } from "@abubakarsiddiik/compiler";
import { afterEach, describe, expect, it } from "vitest";

import { runCoverageDiff } from "./diff.js";
import { nearestControl, repairLocators, similarity } from "./near-match.js";
import { affectedStates, globToRegExp, runSync } from "./sync.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-sync-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const button = (name: string) => ({ role: "button", name, visible: true });

const OP = {
  name: "op_30_days",
  version: 1,
  summary: "Pick the 30 days range.",
  params: { type: "object", properties: {}, required: [], additionalProperties: false },
  returns: { type: "object" },
  from: ["dash"],
  to: ["dash"],
  post: [],
  effect: "read",
  impls: [
    {
      tier: "ui",
      steps: [{ do: "click", target: { role: "button", name: "30 days", ordinal: 0 } }],
      extract: { kind: "none" },
    },
  ],
  status: "verified",
};

function project() {
  const dir = tempDir();
  const maps = join(dir, "maps");
  mkdirSync(join(maps, "app"), { recursive: true });
  writeFileSync(
    join(maps, "app", "v1.json"),
    JSON.stringify({
      site: "app",
      origins: ["http://app.test"],
      version: 1,
      states: [
        { id: "dash", url: "/dash", marks: [] },
        { id: "orgs", url: "/orgs", marks: [] },
      ],
      ops: [OP],
      entities: {},
      compiled_from: [],
      verified_at: "2026-11-17T00:00:00.000Z",
    }),
  );
  writeFileSync(
    join(maps, "app", "capabilities.json"),
    JSON.stringify({
      schema: 1,
      site: "app",
      generated_at: "2026-11-17T00:00:00.000Z",
      capabilities: [
        {
          id: "dash.button.30_days",
          page: "dash",
          trigger: { kind: "button", name: "30 days" },
          status: "mapped",
          source: "live",
          op: "op_30_days",
        },
      ],
    }),
  );
  return { dir, maps };
}

describe("near match", () => {
  it("scores shared words, and finds one clearly closest control", () => {
    expect(similarity("30 days", "Last 30 days")).toBeGreaterThanOrEqual(0.6);
    expect(similarity("Export", "Delete")).toBe(0);

    const nodes = [
      button("Last 30 days"),
      button("Export"),
      { role: "link", name: "30 days", visible: true },
    ];
    expect(nearestControl("button", "30 days", nodes)).toBe("Last 30 days");
    expect(nearestControl("button", "Archive", nodes)).toBeUndefined();
    // Two equally close controls are a guess, not a repair.
    expect(
      nearestControl("button", "30 days", [button("Last 30 days"), button("Past 30 days")]),
    ).toBeUndefined();
  });

  it("repairs the locator in a ui op, and leaves one that still resolves alone", () => {
    const fixed = repairLocators(OP as never, [button("Last 30 days")]);
    expect(fixed?.impls[0]).toMatchObject({
      steps: [{ target: { role: "button", name: "Last 30 days" } }],
    });
    expect(repairLocators(OP as never, [button("30 days")])).toBeUndefined();
    expect(repairLocators(OP as never, [button("Something else")])).toBeUndefined();
  });
});

describe("affected states", () => {
  const states = [
    { id: "admin_users", url: "/admin/users" },
    { id: "admin_keys", url: "/admin/keys" },
    { id: "org_detail", url: "/orgs/:id" },
  ];

  it("matches globs", () => {
    expect(globToRegExp("src/admin/**").test("src/admin/users/Table.tsx")).toBe(true);
    expect(globToRegExp("src/admin/**").test("src/other/x.ts")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("**/*.tsx").test("a/b/c.tsx")).toBe(true);
    expect(globToRegExp("admin_*").test("admin_users")).toBe(true);
  });

  it("attributes files through config globs and through route files", () => {
    const result = affectedStates(
      ["src/admin/Keys.tsx", "src/pages/Org.tsx", "src/lib/util.ts", "README.md"],
      states,
      { paths: { "src/admin/**": ["admin_*"] }, src: "src" },
      [{ file: join(process.cwd(), "src/pages/Org.tsx"), routes: ["/orgs/:orgId"] }],
    );

    expect(result.affected).toEqual(["admin_keys", "admin_users", "org_detail"]);
    expect(result.unmapped).toEqual(["src/lib/util.ts"]);
  });
});

describe("runSync", () => {
  const base = (p: ReturnType<typeof project>, extra: Record<string, unknown> = {}) => ({
    site: "app",
    mapsDir: p.maps,
    since: "origin/main",
    sync: { paths: { "src/dash/**": ["dash"] } },
    verify: true,
    verifyWrites: false,
    publish: true,
    ...extra,
  });

  const failing = (message: string) => async (): Promise<VerifyReport> => ({
    op: "op_30_days",
    verified: false,
    impls: [{ tier: "ui", verified: false, runs: [{ params: {}, ok: false, message }] }],
    reason: "every impl failed",
  });

  it("does nothing when no change touches a state, and stops at --dry-run", async () => {
    const p = project();
    let built = 0;
    const deps = {
      build: async () => {
        built += 1;
        return {} as never;
      },
    };

    const quiet = await runSync(base(p), { ...deps, changedFiles: () => ["README.md"] });
    expect(quiet.affected).toEqual([]);

    const dry = await runSync(base(p, { dryRun: true }), {
      ...deps,
      changedFiles: () => ["src/dash/Filters.tsx"],
    });
    expect(dry.affected).toEqual(["dash"]);
    expect(built).toBe(0);
  });

  it("repairs an op whose control was renamed, and publishes the repair", async () => {
    const p = project();
    const published: string[] = [];
    let call = 0;

    const result = await runSync(base(p), {
      changedFiles: () => ["src/dash/Filters.tsx"],
      build: async () => ({ coverage: {} }) as never,
      verify: async (options) => {
        call += 1;
        const name = (options.op.impls[0] as { steps: Array<{ target: { name: string } }> })
          .steps[0]?.target.name;
        return name === "Last 30 days"
          ? { op: options.op.name, verified: true, impls: [] }
          : failing("step 0: locator did not resolve")();
      },
      nodesFor: async () => [button("Last 30 days")],
      publish: async (options) => {
        published.push(...options.candidates.map((candidate) => candidate.op.name));
        return { version: 2 } as never;
      },
      diff: () => ({ lines: [], failures: [], diff: {} }) as never,
    });

    expect(result.repaired).toEqual(["op_30_days"]);
    expect(result.broken).toEqual({});
    expect(published).toEqual(["op_30_days"]);
    expect(call).toBe(2);
  });

  it("marks an op that cannot be repaired broken and its capability stale", async () => {
    const p = project();

    const result = await runSync(base(p), {
      changedFiles: () => ["src/dash/Filters.tsx"],
      build: async () => ({ coverage: {} }) as never,
      verify: failing("step 0: locator did not resolve"),
      nodesFor: async () => [button("Unrelated")],
      diff: () => ({ lines: [], failures: [], diff: {} }) as never,
    });

    expect(result.broken.op_30_days).toContain("locator did not resolve");
    const ledger = JSON.parse(readFileSync(join(p.maps, "app", "capabilities.json"), "utf8"));
    expect(ledger.capabilities[0]).toMatchObject({ status: "stale" });
    expect(ledger.capabilities[0].reason).toContain("no longer verifies");
  });

  it("does not call a broken page's op repaired when the failure is not a locator", async () => {
    const p = project();
    const result = await runSync(base(p), {
      changedFiles: () => ["src/dash/Filters.tsx"],
      build: async () => ({ coverage: {} }) as never,
      verify: failing("expected state dash, found login"),
      nodesFor: async () => [button("Last 30 days")],
      diff: () => ({ lines: [], failures: [], diff: {} }) as never,
    });

    expect(result.repaired).toEqual([]);
    expect(Object.keys(result.broken)).toEqual(["op_30_days"]);
  });
});

describe("coverage --diff", () => {
  it("reports a new missing control against a git ref, and fails on it", () => {
    const p = project();
    const ledgerPath = join(p.maps, "app", "capabilities.json");
    const current = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const before = structuredClone(current);
    current.capabilities.push({
      id: "dash.button.export",
      page: "dash",
      trigger: { kind: "button", name: "Export" },
      status: "missing",
      source: "live",
    });
    writeFileSync(ledgerPath, JSON.stringify(current));

    const git = (args: string[]): string => {
      if (args[0] === "rev-parse") return `${dirname(p.maps)}\n`;
      if (args[0] === "show") return JSON.stringify(before);
      throw new Error("unexpected git call");
    };

    const result = runCoverageDiff(
      { site: "app", mapsDir: p.maps, against: "origin/main", failOn: ["missing"] },
      git,
    );

    expect(result.diff.new_missing.map((item) => item.id)).toEqual(["dash.button.export"]);
    expect(result.failures[0]).toContain('1 new missing: button "Export" on dash');
    expect(result.markdown).toContain("❌");
    expect(result.markdown).toContain("dash.button.export");

    const clean = runCoverageDiff({ site: "app", mapsDir: p.maps, against: "origin/main" }, git);
    expect(clean.failures).toEqual([]);
  });

  it("compares published versions by op", () => {
    const p = project();
    const next = JSON.parse(readFileSync(join(p.maps, "app", "v1.json"), "utf8"));
    next.version = 2;
    next.ops = [{ ...OP, name: "op_new" }];
    writeFileSync(join(p.maps, "app", "v2.json"), JSON.stringify(next));

    const result = runCoverageDiff({ site: "app", mapsDir: p.maps, against: "v1" });
    expect(result.ops).toEqual({ added: ["op_new"], removed: ["op_30_days"], changed: [] });
    expect(result.lines.join("\n")).toContain("ops added: op_new");
  });
});
