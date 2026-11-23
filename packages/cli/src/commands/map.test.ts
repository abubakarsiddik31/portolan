import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VerifyReport } from "@abubakarsiddiik/compiler";
import { parseMap } from "@abubakarsiddiik/protocol";
import type { OpProposal } from "@abubakarsiddiik/sources";
import type { SemanticNode, Snapshot, Substrate } from "@abubakarsiddiik/substrate";
import { afterEach, describe, expect, it } from "vitest";

import { runMapBuild, seedPolicy, setupFor } from "./map.js";
import { blockedHosts, runPolicyAllow } from "./policy.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-map-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function node(input: Partial<SemanticNode> & { nodeId: string; role: string }): SemanticNode {
  return {
    name: "",
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
    ...input,
  };
}

function page(url: string, nodes: SemanticNode[]): Snapshot {
  return { doc: 1, v: 1, url, title: url, nodes };
}

const home = page("http://app.test/", [
  node({
    nodeId: "root",
    role: "RootWebArea",
    name: "Home",
    childIds: ["form", "cart", "book", "add"],
  }),
  node({
    nodeId: "form",
    role: "form",
    name: "Search",
    attributes: { method: "get", action: "/search" },
    childIds: ["q", "submit"],
  }),
  node({ nodeId: "q", role: "textbox", name: "Search books", attributes: { name: "q" } }),
  node({ nodeId: "submit", role: "button", name: "Search" }),
  node({ nodeId: "cart", role: "link", name: "Cart", attributes: { href: "/cart" } }),
  node({ nodeId: "book", role: "link", name: "Book", attributes: { href: "/products/123" } }),
  node({ nodeId: "add", role: "button", name: "Add Application" }),
]);

const other = page("http://app.test/cart", [
  node({ nodeId: "root", role: "RootWebArea", name: "Cart", childIds: [] }),
]);

const substrate = {
  goto: async (url: string) => ({
    snapshot: new URL(url).pathname === "/" ? home : other,
    refs: undefined,
  }),
} as unknown as Substrate;

const verify: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) =>
  ({ op: options.op.name, verified: true, impls: [] }) satisfies VerifyReport;

describe("runMapBuild", () => {
  it("writes a draft and publishes verified ops", async () => {
    const dir = tempDir();
    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: dir,
        url: "http://app.test/",
        verify: true,
        verifyWrites: false,
        publish: true,
      },
      { substrate, verify, now: "2026-11-17T00:00:00.000Z" },
    );

    expect(result.published?.version).toBe(1);
    expect(result.verified.sort()).toEqual(["open_cart", "open_products", "search"]);

    expect(result.coverage).toMatchObject({ mapped: 3, missing: 1 });
    expect(readFileSync(result.capabilitiesPath, "utf8")).toContain("Add Application");

    const map = parseMap(readFileSync(join(dir, "app", "v1.json"), "utf8"));
    expect(map.site).toBe("app");
    expect(map.ops.map((op) => op.name).sort()).toEqual(["open_cart", "open_products", "search"]);
    expect(map.states.map((state) => state.id)).toEqual(
      expect.arrayContaining(["home", "cart", "products", "search"]),
    );

    const task = JSON.parse(readFileSync(join(dir, "app", "tasks.json"), "utf8")) as {
      tasks: Array<{ kind: string }>;
    };
    expect(task.tasks.length).toBeGreaterThan(0);

    const next = await runMapBuild(
      {
        site: "app",
        mapsDir: dir,
        url: "http://app.test/",
        verify: true,
        verifyWrites: false,
        publish: true,
        update: true,
      },
      { substrate, verify },
    );

    expect(next.published?.version).toBe(2);
    expect(next.published?.map.ops.map((op) => op.name).sort()).toEqual([
      "open_cart",
      "open_products",
      "search",
    ]);
  });

  it("closes the discovery browser before verification starts", async () => {
    const events: string[] = [];
    const recording: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      events.push(`verify ${options.op.name}`);
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    await runMapBuild(
      {
        site: "app",
        mapsDir: tempDir(),
        url: "http://app.test/",
        verify: true,
        verifyWrites: false,
        publish: false,
      },
      {
        substrate,
        verify: recording,
        closeSubstrate: async () => void events.push("close discovery"),
      },
    );

    expect(events[0]).toBe("close discovery");
    expect(events.filter((event) => event === "close discovery")).toHaveLength(1);
    expect(events.length).toBeGreaterThan(1);
  });

  it("keeps going when one op crashes verification", async () => {
    const dir = tempDir();
    const flaky: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      if (options.op.name === "open_cart") throw new Error("navigation crashed");
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: dir,
        url: "http://app.test/",
        verify: true,
        verifyWrites: false,
        publish: true,
      },
      { substrate, verify: flaky },
    );

    expect(result.verified).not.toContain("open_cart");
    expect(result.published?.map.ops.map((op) => op.name)).not.toContain("open_cart");
    expect(result.draft.tasks).toContainEqual(
      expect.objectContaining({ kind: "restore_op", op: "open_cart" }),
    );

    // The ledger counts only what verified: the failed op's trigger is a gap
    // with the verify failure as the reason.
    expect(result.coverage).toMatchObject({ mapped: 2, missing: 2 });
    const ledger = JSON.parse(readFileSync(result.capabilitiesPath, "utf8")) as {
      capabilities: Array<{
        trigger: { name: string };
        status: string;
        reason?: string;
        op?: string;
      }>;
    };
    const cart = ledger.capabilities.find((item) => item.trigger.name === "Cart");
    expect(cart).toMatchObject({ status: "missing" });
    expect(cart?.op).toBeUndefined();
    expect(cart?.reason).toContain("open_cart did not verify: verification crashed");
  });

  it("reads --traces-dir alongside --url", async () => {
    const dir = tempDir();
    const tracesDir = join(dir, "traces");
    mkdirSync(tracesDir);
    const at = "2026-11-17T00:00:00.000Z";
    const trace = {
      scope_id: "run-1",
      sid: "sid-1",
      intent: "export",
      effect: "read",
      started_at: at,
      ended_at: at,
      entries: [
        {
          kind: "act",
          at,
          ref: "e1",
          do: "click",
          locator: { role: "button", name: "Export", ordinal: 0 },
          doc: 1,
          v: 1,
          url: "http://app.test/",
          effects: [],
          delta: { navigation: false, entries: [] },
        },
      ],
    };
    writeFileSync(join(tracesDir, "traces.jsonl"), `${JSON.stringify(trace)}\n`);

    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        url: "http://app.test/",
        tracesDir,
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate },
    );

    expect(result.draft.sources).toEqual(expect.arrayContaining(["dom", "traces"]));
    expect(result.draft.proposals.some((proposal) => proposal.source === "traces")).toBe(true);
  });

  it("compiles a recorded write to ui, or to http with --outcome-checks", async () => {
    const dir = tempDir();
    const at = "2026-11-17T00:00:00.000Z";
    const trace = {
      scope_id: "run-1",
      sid: "sid-1",
      intent: "sign in",
      effect: "write",
      started_at: at,
      ended_at: at,
      entries: [
        {
          kind: "act",
          at,
          ref: "e1",
          do: "click",
          locator: { role: "button", name: "Sign in", ordinal: 0 },
          doc: 1,
          v: 1,
          url: "http://app.test/dashboard",
          effects: [
            {
              kind: "network",
              method: "POST",
              url: "http://app.test/api/login",
              status: 200,
              request_body: { email: "a@b.c" },
              response_body: { ok: true },
            },
          ],
          delta: { navigation: false, entries: [] },
        },
      ],
    };
    const tracePath = join(dir, "trace.json");
    writeFileSync(tracePath, JSON.stringify(trace));
    const checksPath = join(dir, "checks.json");
    writeFileSync(checksPath, JSON.stringify({ sign_in: "whoami" }));

    const base = {
      site: "app",
      traces: [tracePath],
      baseUrl: "http://app.test",
      verify: false,
      verifyWrites: false,
      publish: false,
    };

    const bare = await runMapBuild({ ...base, mapsDir: join(dir, "a") }, { substrate });
    const withoutCheck = bare.draft.proposals.find((p) => p.op.name === "sign_in");
    expect(withoutCheck?.op.impls[0]?.tier).toBe("ui");

    const checked = await runMapBuild(
      { ...base, mapsDir: join(dir, "b"), outcomeChecksPath: checksPath },
      { substrate },
    );
    const withCheck = checked.draft.proposals.find((p) => p.op.name === "sign_in");
    expect(withCheck?.op.impls[0]?.tier).toBe("http");
    expect(withCheck?.op.outcome_check).toBe("whoami");
  });

  it("records when the crawl stops at --max-pages with pages still queued", async () => {
    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: tempDir(),
        url: "http://app.test/",
        maxPages: 1,
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate },
    );

    expect(result.draft.build.crawl_truncated).toMatchObject({ limit: "max-pages", value: 1 });
    expect(result.draft.build.crawl_truncated?.queued).toBeGreaterThan(0);

    const full = await runMapBuild(
      {
        site: "app",
        mapsDir: tempDir(),
        url: "http://app.test/",
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate },
    );
    expect(full.draft.build.crawl_truncated).toBeUndefined();
  });

  it("keeps the verify failures in the draft when nothing verifies", async () => {
    const dir = tempDir();
    const failing: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => ({
      op: options.op.name,
      verified: false,
      impls: [],
      reason: "every impl failed",
    });

    await expect(
      runMapBuild(
        {
          site: "app",
          mapsDir: dir,
          url: "http://app.test/",
          verify: true,
          verifyWrites: false,
          publish: true,
        },
        { substrate, verify: failing },
      ),
    ).rejects.toThrow(/nothing verified[\s\S]*open_cart did not verify: every impl failed/);

    const tasks = JSON.parse(readFileSync(join(dir, "app", "tasks.json"), "utf8")) as {
      tasks: Array<{ message: string }>;
    };
    expect(
      tasks.tasks.some((task) => task.message.includes("did not verify: every impl failed")),
    ).toBe(true);
  });

  it("passes the storage state to verification", async () => {
    const seen: Array<string | undefined> = [];
    const capture: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      seen.push(options.storageState);
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    await runMapBuild(
      {
        site: "app",
        mapsDir: tempDir(),
        url: "http://app.test/",
        storageState: "/tmp/auth.json",
        verify: true,
        verifyWrites: false,
        publish: false,
      },
      { substrate, verify: capture },
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === "/tmp/auth.json")).toBe(true);
  });

  it("refuses to publish with --require-complete while capabilities are missing", async () => {
    await expect(
      runMapBuild(
        {
          site: "app",
          mapsDir: tempDir(),
          url: "http://app.test/",
          verify: true,
          verifyWrites: false,
          publish: true,
          requireComplete: true,
        },
        { substrate, verify },
      ),
    ).rejects.toThrow(/missing/);
  });

  it("refuses to publish without verification", async () => {
    await expect(
      runMapBuild(
        {
          site: "app",
          mapsDir: tempDir(),
          url: "http://app.test/",
          verify: false,
          verifyWrites: false,
          publish: true,
        },
        { substrate },
      ),
    ).rejects.toThrow(/requires --verify/);
  });

  it("requires an existing map when updating", async () => {
    await expect(
      runMapBuild(
        {
          site: "missing",
          mapsDir: tempDir(),
          url: "http://app.test/",
          update: true,
          verify: false,
          verifyWrites: false,
          publish: false,
        },
        { substrate },
      ),
    ).rejects.toThrow(/no map for "missing"/);
  });
});

describe("setupFor", () => {
  const reads = (name: string, from: string, to: string, tier: "url" | "ui"): OpProposal =>
    ({
      op: {
        name,
        effect: "read",
        from: [from],
        to: [to],
        params: { type: "object", properties: {}, additionalProperties: false },
        impls: [tier === "url" ? { tier, route: "/orgs/:id" } : { tier, steps: [] }],
      },
      sample_params: tier === "url" ? [{ id: "2" }] : undefined,
    }) as unknown as OpProposal;

  const draft = (proposals: OpProposal[]) =>
    ({
      states: [
        { id: "dashboard", url: "/dashboard", marks: [] },
        { id: "org_detail", url: "/orgs/:id", marks: [] },
      ],
      proposals,
    }) as unknown as Parameters<typeof setupFor>[0];

  it("opens a parameterized start state with the read op that leads there", () => {
    const open = reads("open_org_detail", "dashboard", "org_detail", "url");
    const click = reads("op_30_days", "org_detail", "org_detail", "ui");

    expect(setupFor(draft([open, click]), click)).toEqual([
      { op: "open_org_detail", params: { id: "2" } },
    ]);
  });

  it("needs no setup on a static state or without an opener", () => {
    const open = reads("open_org_detail", "dashboard", "org_detail", "url");
    const click = reads("op_30_days", "org_detail", "org_detail", "ui");
    const staticClick = reads("op_export", "dashboard", "dashboard", "ui");

    expect(setupFor(draft([open, staticClick]), staticClick)).toBeUndefined();
    expect(setupFor(draft([click]), click)).toBeUndefined();
  });
});

describe("seedPolicy", () => {
  it("allows the build's host when init left the allow list empty", () => {
    expect(seedPolicy({ site: "app", allow: [] }, "http://localhost:5173/admin")).toEqual({
      site: "app",
      allow: ["localhost:5173"],
    });
  });

  it("leaves a policy that lists hosts exactly as written", () => {
    const policy = { site: "app", allow: ["app.example.com"] };
    expect(seedPolicy(policy, "http://localhost:5173/")).toBe(policy);
    expect(seedPolicy(undefined, "http://localhost:5173/")).toBeUndefined();
  });
});

describe("cost and destructive rules", () => {
  const at = "2026-11-17T00:00:00.000Z";

  function setup() {
    const dir = tempDir();
    const tracePath = join(dir, "trace.json");
    writeFileSync(
      tracePath,
      JSON.stringify({
        scope_id: "run-1",
        sid: "sid-1",
        intent: "ask",
        effect: "write",
        started_at: at,
        ended_at: at,
        entries: [
          {
            kind: "act",
            at,
            ref: "e1",
            do: "click",
            locator: { role: "button", name: "Ask", ordinal: 0 },
            doc: 1,
            v: 1,
            url: "http://app.test/chat",
            effects: [
              {
                kind: "network",
                method: "POST",
                url: "http://app.test/api/ask/stream",
                status: 200,
                request_body: { q: "hi" },
                response_body: { ok: true },
              },
            ],
            delta: { navigation: false, entries: [] },
          },
        ],
      }),
    );
    const policies = join(dir, "policies");
    mkdirSync(policies);
    writeFileSync(
      join(policies, "app.json"),
      JSON.stringify({
        site: "app",
        allow: ["app.test"],
        rules: [{ category: "cost", request: "POST */ask/stream*", reason: "LLM call" }],
      }),
    );
    const paramsPath = join(dir, "params.json");
    writeFileSync(paramsPath, JSON.stringify({ ask: [{}, {}, {}] }));
    return { dir, tracePath, policies, paramsPath };
  }

  const input = (s: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) => ({
    site: "app",
    mapsDir: join(s.dir, "maps"),
    traces: [s.tracePath],
    baseUrl: "http://app.test",
    policiesDir: s.policies,
    paramsPath: s.paramsPath,
    verify: true,
    verifyWrites: true,
    publish: false,
    ...extra,
  });

  it("keeps an op whose run fired a cost request out of verification", async () => {
    const s = setup();
    const seen: string[] = [];
    const recording: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      seen.push(options.op.name);
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    const result = await runMapBuild(input(s), { substrate, verify: recording });

    expect(seen).toEqual([]);
    expect(result.draft.proposals[0]?.risk).toEqual({
      category: "cost",
      reason: "cost: LLM call",
    });
    expect(result.draft.tasks).toContainEqual(
      expect.objectContaining({
        kind: "confirm_effect",
        message: expect.stringContaining("--allow-cost"),
      }),
    );

    const allowed = await runMapBuild(input(s, { allowCost: true }), {
      substrate,
      verify: recording,
    });
    expect(allowed.verified).toEqual(["ask"]);
  });
});

describe("policy allow", () => {
  it("adds hosts once and creates the policy when missing", () => {
    const dir = tempDir();
    expect(
      runPolicyAllow({ site: "app", policiesDir: dir, hosts: ["localhost:8000"] }).added,
    ).toEqual(["localhost:8000"]);
    const again = runPolicyAllow({
      site: "app",
      policiesDir: dir,
      hosts: ["localhost:8000", "api.test"],
    });
    expect(again.added).toEqual(["api.test"]);
    expect(JSON.parse(readFileSync(again.path, "utf8"))).toEqual({
      site: "app",
      allow: ["localhost:8000", "api.test"],
    });
    expect(() => runPolicyAllow({ site: "app", policiesDir: dir, hosts: [] })).toThrow(
      /at least one host/,
    );
  });

  it("finds the hosts egress refused", () => {
    expect(
      blockedHosts([
        "could not open http://localhost:8000/x: egress blocked: GET http://localhost:8000/x (not_allowed)",
        "could not open http://a.test/: egress blocked: GET http://a.test/ (private_address)",
        "something else",
      ]),
    ).toEqual(["localhost:8000"]);
  });
});

describe("map update --state", () => {
  it("re-crawls only the named state and leaves the rest of the ledger alone", async () => {
    const dir = tempDir();
    const base = {
      site: "app",
      mapsDir: dir,
      url: "http://app.test/",
      verify: true,
      verifyWrites: false,
      publish: true,
    };
    await runMapBuild(base, { substrate, verify });

    const visited: string[] = [];
    const watching = {
      goto: async (url: string) => {
        visited.push(url);
        return substrate.goto(url);
      },
    } as unknown as Substrate;

    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: dir,
        update: true,
        states: ["cart"],
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate: watching },
    );

    expect(visited).toEqual(["http://app.test/cart"]);
    const byName = new Map(
      result.capabilities.capabilities.map((item) => [item.trigger.name, item]),
    );
    expect(byName.get("Cart")?.status).toBe("mapped");
    expect(byName.get("Search")?.status).toBe("mapped");
    expect(result.coverage.removed).toBe(0);
  });

  it("refuses --state without update", async () => {
    await expect(
      runMapBuild(
        {
          site: "app",
          mapsDir: tempDir(),
          url: "http://app.test/",
          states: ["cart"],
          verify: false,
          verifyWrites: false,
          publish: false,
        },
        { substrate },
      ),
    ).rejects.toThrow(/needs `map update`/);
  });
});

describe("faster verification", () => {
  const build = (dir: string, extra: Record<string, unknown> = {}) => ({
    site: "app",
    mapsDir: dir,
    url: "http://app.test/",
    verify: true,
    verifyWrites: false,
    publish: true,
    appVersion: "build-1",
    ...extra,
  });

  it("skips ops already verified against the same app build", async () => {
    const dir = tempDir();
    await runMapBuild(build(dir), { substrate, verify });

    const seen: string[] = [];
    const recording: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      seen.push(options.op.name);
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    const again = await runMapBuild(build(dir, { update: true }), { substrate, verify: recording });
    expect(seen).toEqual([]);
    expect(again.verified.length).toBeGreaterThan(0);
    expect(again.reports.every((report) => report.reason?.startsWith("unchanged since"))).toBe(
      true,
    );

    const reverified = await runMapBuild(build(dir, { update: true, reverify: true }), {
      substrate,
      verify: recording,
    });
    expect(seen.length).toBe(reverified.verified.length);

    seen.length = 0;
    await runMapBuild(build(dir, { update: true, appVersion: "build-2" }), {
      substrate,
      verify: recording,
    });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("verifies reads side by side up to the limit", async () => {
    let active = 0;
    let peak = 0;
    const slow: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    await runMapBuild(build(tempDir(), { publish: false, concurrency: 2 }), {
      substrate,
      verify: slow,
    });

    expect(peak).toBe(2);
  });
});

describe("postconditions", () => {
  const at = "2026-11-17T00:00:00.000Z";

  function setup() {
    const dir = tempDir();
    const tracePath = join(dir, "trace.json");
    const act = (name: string, v: number, effects: unknown[]) => ({
      kind: "act",
      at,
      ref: `e${v}`,
      do: "click",
      locator: { role: "button", name, ordinal: 0 },
      doc: 1,
      v,
      url: "http://app.test/analytics?range=30d",
      effects,
      delta: { navigation: false, entries: [] },
    });
    writeFileSync(
      tracePath,
      JSON.stringify({
        scope_id: "run-1",
        sid: "sid-1",
        intent: "filter",
        effect: "read",
        started_at: at,
        ended_at: at,
        entries: [
          act("30 days", 1, [
            {
              kind: "navigation",
              from: "http://app.test/analytics",
              to: "http://app.test/analytics?range=30d",
              doc: 1,
            },
          ]),
        ],
      }),
    );
    return { dir, tracePath };
  }

  const base = (s: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) => ({
    site: "app",
    mapsDir: join(s.dir, "maps"),
    traces: [s.tracePath],
    baseUrl: "http://app.test",
    verify: false,
    verifyWrites: false,
    publish: false,
    ...extra,
  });

  it("proposes the postcondition the recording showed, and shows it in the draft", async () => {
    const s = setup();
    const result = await runMapBuild(base(s), { substrate });

    const proposal = result.draft.proposals.find((p) => p.op.name === "op_30_days");
    expect(proposal?.op.post).toEqual([
      { kind: "url", pattern: "^/analytics$", search: "(^|&)range=30d(&|$)" },
    ]);
    expect(proposal?.notes?.join(" ")).toContain("Inferred postconditions");

    const off = await runMapBuild(base(s, { noInferPost: true }), { substrate });
    expect(off.draft.proposals.find((p) => p.op.name === "op_30_days")?.op.post).toEqual([]);
  });

  it("flags a ui op with no postcondition, and holds it under --require-post", async () => {
    const s = setup();
    const seen: string[] = [];
    const recording: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      seen.push(options.op.name);
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    const result = await runMapBuild(
      base(s, { verify: true, noInferPost: true, requirePost: true }),
      { substrate, verify: recording },
    );

    expect(seen).toEqual([]);
    expect(result.draft.tasks).toContainEqual(
      expect.objectContaining({ kind: "add_postcondition", op: "op_30_days" }),
    );

    const lenient = await runMapBuild(
      base(s, { verify: true, noInferPost: true, mapsDir: join(s.dir, "maps2") }),
      { substrate, verify: recording },
    );
    expect(lenient.verified).toEqual(["op_30_days"]);
  });
});

describe("entry points and routes", () => {
  it("seeds static routes, and reports a parameterized route nothing reached", async () => {
    const dir = tempDir();
    const routesPath = join(dir, "routes.txt");
    writeFileSync(routesPath, "/cart\n/ghost/:id\n");

    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        url: "http://app.test/",
        routesPath,
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate },
    );

    expect(result.discovery?.visited).toContain("http://app.test/cart");
    expect(result.discovery?.unreached).toEqual(["/ghost/:id"]);
  });

  it("mines routes from source", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "App.tsx"), '<Route path="/cart" element={x} />');

    const result = await runMapBuild(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        url: "http://app.test/",
        routesFrom: "react-router",
        src: join(dir, "src"),
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      { substrate },
    );

    expect(result.discovery?.unreached).toBeUndefined();
    expect(result.discovery?.visited).toContain("http://app.test/cart");
  });
});

describe("session refresh during a build", () => {
  const build = (dir: string, extra: Record<string, unknown> = {}) => ({
    site: "app",
    mapsDir: dir,
    url: "http://app.test/",
    verify: true,
    verifyWrites: false,
    publish: false,
    appVersion: "build-1",
    ...extra,
  });

  it("signs in again once and retries an op that failed because the session lapsed", async () => {
    let refreshed = 0;
    const calls = new Map<string, number>();
    const lapsing: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      const n = (calls.get(options.op.name) ?? 0) + 1;
      calls.set(options.op.name, n);
      if (options.op.name === "open_cart" && refreshed === 0) {
        return {
          op: "open_cart",
          verified: false,
          impls: [],
          reason: 'op "open_cart" needs home, found login',
        } satisfies VerifyReport;
      }
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    const result = await runMapBuild(build(tempDir()), {
      substrate,
      verify: lapsing,
      refreshAuth: async () => {
        refreshed += 1;
      },
    });

    expect(refreshed).toBe(1);
    expect(calls.get("open_cart")).toBe(2);
    expect(result.verified).toContain("open_cart");
  });

  it("does not sign in again for an op that is simply broken", async () => {
    let refreshed = 0;
    const broken: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) =>
      ({
        op: options.op.name,
        verified: false,
        impls: [],
        reason: "locator did not resolve",
      }) satisfies VerifyReport;

    await expect(
      runMapBuild(build(tempDir(), { publish: true }), {
        substrate,
        verify: broken,
        refreshAuth: async () => {
          refreshed += 1;
        },
      }),
    ).rejects.toThrow(/nothing verified/);
    expect(refreshed).toBe(0);
  });

  it("replaces a session that is about to expire before verifying", async () => {
    const dir = tempDir();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = `${Buffer.from(`{"alg":"HS256"}`).toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
    const storageState = join(dir, "auth.json");
    writeFileSync(
      storageState,
      JSON.stringify({
        cookies: [],
        origins: [{ origin: "http://app.test", localStorage: [{ name: "t", value: token }] }],
      }),
    );

    const order: string[] = [];
    const recording: typeof import("@abubakarsiddiik/compiler").verifyOp = async (options) => {
      order.push("verify");
      return { op: options.op.name, verified: true, impls: [] } satisfies VerifyReport;
    };

    await runMapBuild(build(join(dir, "maps"), { storageState }), {
      substrate,
      verify: recording,
      refreshAuth: async () => {
        order.push("refresh");
      },
    });

    expect(order[0]).toBe("refresh");
    expect(order.filter((step) => step === "refresh")).toHaveLength(1);
  });
});
