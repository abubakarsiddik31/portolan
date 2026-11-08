import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { describe, expect, it } from "vitest";

import { routableOps, routeTo, routeToAny } from "./router.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function map(site: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, site, "v1.json"), "utf8"));
}

function op(partial: Partial<OpDef> & Pick<OpDef, "name" | "effect">): OpDef {
  return {
    version: 1,
    summary: partial.name,
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: [],
    to: [],
    post: [],
    impls: [{ tier: "url", route: "/", extract: { kind: "none" } }],
    status: "verified",
    ...partial,
  };
}

function custom(states: string[], ops: OpDef[]): SiteMap {
  return {
    site: "test",
    origins: ["http://x"],
    version: 1,
    states: states.map((id) => ({ id, marks: [{ role: "heading", name: id }] })),
    ops,
    entities: {},
    compiled_from: [],
    verified_at: "2026-11-08T00:00:00Z",
  };
}

describe("fixture routes", () => {
  it("routes from catalog to product with a read op", () => {
    expect(routeTo(map("store"), "catalog", "product")).toEqual([
      { op: "get_product", from: "catalog", to: "product" },
    ]);
  });

  it("routes from catalog to cart with a read op", () => {
    expect(routeTo(map("store"), "catalog", "cart")).toEqual([
      { op: "view_cart", from: "catalog", to: "cart" },
    ]);
  });

  it("returns an empty route when already in the target", () => {
    expect(routeTo(map("store"), "cart", "cart")).toEqual([]);
  });

  it("routes from cart to checkout with a read op", () => {
    expect(routeTo(map("store"), "cart", "checkout")).toEqual([
      { op: "open_checkout", from: "cart", to: "checkout" },
    ]);
  });

  it("never routes to an order, which needs an irreversible op", () => {
    expect(routeTo(map("store"), "catalog", "order")).toBeUndefined();
  });

  it("does not route from login to the ledger, because login is a write", () => {
    expect(routeTo(map("portal"), "login", "invoices")).toBeUndefined();
  });

  it("does not route between wizard steps, because the only op is a write", () => {
    expect(routeTo(map("wizard"), "step1", "step3")).toBeUndefined();
  });
});

describe("read-only bfs", () => {
  it("chains read ops", () => {
    const model = custom(
      ["a", "b", "c"],
      [
        op({ name: "ab", effect: "read", from: ["a"], to: ["b"] }),
        op({ name: "bc", effect: "read", from: ["b"], to: ["c"] }),
      ],
    );

    expect(routeTo(model, "a", "c")).toEqual([
      { op: "ab", from: "a", to: "b" },
      { op: "bc", from: "b", to: "c" },
    ]);
  });

  it("picks the shortest path", () => {
    const model = custom(
      ["a", "b", "c", "d"],
      [
        op({ name: "ab", effect: "read", from: ["a"], to: ["b"] }),
        op({ name: "bc", effect: "read", from: ["b"], to: ["c"] }),
        op({ name: "cd", effect: "read", from: ["c"], to: ["d"] }),
        op({ name: "ad", effect: "read", from: ["a"], to: ["d"] }),
      ],
    );

    expect(routeTo(model, "a", "d")).toEqual([{ op: "ad", from: "a", to: "d" }]);
  });

  it("breaks ties by declaration order", () => {
    const model = custom(
      ["a", "b"],
      [
        op({ name: "first", effect: "read", from: ["a"], to: ["b"] }),
        op({ name: "second", effect: "read", from: ["a"], to: ["b"] }),
      ],
    );

    expect(routeTo(model, "a", "b")?.[0]?.op).toBe("first");
  });

  it("handles an op with several from states", () => {
    const model = custom(
      ["a", "b", "c"],
      [op({ name: "to_c", effect: "read", from: ["a", "b"], to: ["c"] })],
    );

    expect(routeTo(model, "b", "c")).toEqual([{ op: "to_c", from: "b", to: "c" }]);
  });

  it("does not loop on a cycle", () => {
    const model = custom(
      ["a", "b"],
      [
        op({ name: "ab", effect: "read", from: ["a"], to: ["b"] }),
        op({ name: "ba", effect: "read", from: ["b"], to: ["a"] }),
      ],
    );

    expect(routeTo(model, "a", "missing")).toBeUndefined();
  });

  it("ignores write and irreversible ops", () => {
    const model = custom(
      ["a", "b"],
      [
        op({ name: "write_ab", effect: "write", from: ["a"], to: ["b"] }),
        op({ name: "irreversible_ab", effect: "irreversible", from: ["a"], to: ["b"] }),
      ],
    );

    expect(routeTo(model, "a", "b")).toBeUndefined();
    expect(routableOps(model)).toEqual([]);
  });

  it("ignores broken read ops", () => {
    const model = custom(
      ["a", "b"],
      [op({ name: "broken", effect: "read", from: ["a"], to: ["b"], status: "broken" })],
    );

    expect(routeTo(model, "a", "b")).toBeUndefined();
  });

  it("routes to the nearest of several targets", () => {
    const model = custom(
      ["a", "b", "c"],
      [
        op({ name: "ab", effect: "read", from: ["a"], to: ["b"] }),
        op({ name: "ac", effect: "read", from: ["a"], to: ["c"] }),
      ],
    );

    expect(routeToAny(model, "a", ["c", "b"])?.[0]?.op).toBe("ab");
  });
});
