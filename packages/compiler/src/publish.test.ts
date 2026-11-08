import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishMap } from "./publish.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function listOrders(): OpDef {
  return {
    name: "list_orders",
    version: 1,
    summary: "List orders.",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: ["order"],
    to: ["order"],
    post: [],
    effect: "read",
    status: "verified",
    impls: [{ tier: "url", route: "/orders", extract: { kind: "none" } }],
  };
}

function deleteAccount(): OpDef {
  return {
    name: "delete_account",
    version: 1,
    summary: "Delete the account.",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: ["order"],
    to: ["order"],
    post: [],
    effect: "irreversible",
    confirm: true,
    status: "verified",
    impls: [
      {
        tier: "ui",
        steps: [{ do: "click", target: { role: "button", name: "Delete account" } }],
        extract: { kind: "none" },
      },
    ],
  };
}

describe("publishMap", () => {
  let dir = "";
  let map: SiteMap;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "portolan-publish-"));
    const source = await readFile(join(MAPS, "store", "v1.json"), "utf8");
    await writeFile(join(dir, "v1.json"), source, "utf8");
    map = parseMap(source);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a new version and holds an irreversible op for review", async () => {
    const search = map.ops.find((op) => op.name === "search");
    if (search === undefined) throw new Error("the search op is missing");

    const result = await publishMap({
      dir,
      map,
      now: "2026-11-09T00:00:00.000Z",
      candidates: [
        {
          op: { ...search, summary: "Search products, lifted." },
          verified: true,
          source: "trace:search-1",
        },
        { op: listOrders(), verified: true, source: "trace:orders-1" },
        { op: deleteAccount(), verified: true, source: "trace:delete-1" },
        { op: { ...search, name: "broken" }, verified: false, source: "trace:broken-1" },
      ],
    });

    expect(result.version).toBe(2);
    expect(result.diff).toEqual({
      added: ["list_orders"],
      changed: ["search"],
      unchanged: [],
      held: ["delete_account"],
      rejected: ["broken"],
    });

    const published = parseMap(await readFile(result.path, "utf8"));
    expect(published.version).toBe(2);
    expect(published.ops.map((op) => op.name)).toContain("list_orders");
    expect(published.ops.map((op) => op.name)).not.toContain("delete_account");
    expect(published.ops.map((op) => op.name)).not.toContain("broken");
    expect(published.verified_at).toBe("2026-11-09T00:00:00.000Z");
    expect(published.compiled_from).toEqual(
      expect.arrayContaining(["trace:search-1", "trace:orders-1"]),
    );
    expect(published.compiled_from).not.toContain("trace:delete-1");
    expect(published.compiled_from).not.toContain("trace:broken-1");

    expect(result.reviewPath).toBeTypeOf("string");
    const review = JSON.parse(await readFile(result.reviewPath as string, "utf8")) as {
      ops: Array<{ op: { name: string }; source?: string }>;
    };
    expect(review.ops).toHaveLength(1);
    expect(review.ops[0]).toMatchObject({
      op: { name: "delete_account" },
      source: "trace:delete-1",
    });
  });

  it("publishes an irreversible op once it is reviewed", async () => {
    const first = await publishMap({
      dir,
      map,
      now: "2026-11-09T00:00:00.000Z",
      candidates: [{ op: deleteAccount(), verified: true, source: "trace:delete-1" }],
    });

    expect(first.diff.held).toEqual(["delete_account"]);
    expect(first.reviewPath).toBeTypeOf("string");

    const second = await publishMap({
      dir,
      map: first.map,
      now: "2026-11-09T01:00:00.000Z",
      candidates: [
        { op: deleteAccount(), verified: true, reviewed: true, source: "trace:delete-1" },
      ],
    });

    expect(second.version).toBe(3);
    expect(second.diff.added).toEqual(["delete_account"]);
    expect(second.reviewPath).toBeUndefined();

    const published = parseMap(await readFile(second.path, "utf8"));
    expect(published.ops.map((op) => op.name)).toContain("delete_account");
    expect(published.compiled_from).toContain("trace:delete-1");
  });

  it("refuses to reuse a version", async () => {
    await expect(publishMap({ dir, map, candidates: [], version: map.version })).rejects.toThrow(
      /must be greater/,
    );
  });
});
