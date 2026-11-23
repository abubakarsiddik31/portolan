import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VerifyReport } from "@abubakarsiddiik/compiler";
import { parseMap } from "@abubakarsiddiik/protocol";
import type { OpProposal } from "@abubakarsiddiik/sources";
import type { SemanticNode, Snapshot, Substrate } from "@abubakarsiddiik/substrate";
import { afterEach, describe, expect, it } from "vitest";

import { runMapBuild, setupFor } from "./map.js";

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
