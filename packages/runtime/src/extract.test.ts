import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { SemanticNode, Snapshot, SubstrateView } from "@abubakarsiddiik/substrate";
import { buildRefMap } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { checkPost, extract, validateReturns } from "./extract.js";

function node(partial: Partial<SemanticNode> & Pick<SemanticNode, "role">): SemanticNode {
  return {
    nodeId: partial.nodeId ?? `${partial.role}:${partial.name ?? ""}`,
    role: partial.role,
    name: partial.name ?? "",
    ignored: false,
    visible: partial.visible ?? true,
    properties: partial.properties ?? {},
    childIds: partial.childIds ?? [],
    ...(partial.test_id !== undefined ? { test_id: partial.test_id } : {}),
    ...(partial.backendNodeId !== undefined ? { backendNodeId: partial.backendNodeId } : {}),
    ...(partial.bounds !== undefined ? { bounds: partial.bounds } : {}),
  };
}

function view(nodes: SemanticNode[], url = "http://x/"): SubstrateView {
  const snapshot: Snapshot = { doc: 1, v: 0, url, title: "", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

function opDef(overrides: Partial<OpDef>): OpDef {
  return {
    name: "test",
    version: 1,
    summary: "test",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: [],
    to: [],
    post: [],
    effect: "read",
    impls: [{ tier: "url", route: "/", extract: { kind: "none" } }],
    status: "verified",
    ...overrides,
  };
}

const ORDER_NODES = [
  node({ nodeId: "h", role: "heading", name: "Order confirmed" }),
  node({ nodeId: "o", role: "strong", test_id: "order-id", childIds: ["t"] }),
  node({ nodeId: "t", role: "StaticText", name: "ord_1001" }),
];

const CART_NODES = [
  node({ nodeId: "table", role: "table", test_id: "cart-table", childIds: ["row"] }),
  node({ nodeId: "row", role: "row", test_id: "cart-row", childIds: ["link", "qty", "total"] }),
  node({ nodeId: "link", role: "link", name: "Everyday Tee" }),
  node({ nodeId: "qty", role: "spinbutton", properties: { value: 1 } }),
  node({ nodeId: "total", role: "cell", name: "$24.00" }),
];

describe("extract", () => {
  it("falls back to StaticText when the accessibility name is empty", () => {
    const result = extract(
      { kind: "fields", fields: { order_id: { test_id: "order-id", attr: "text" } } },
      view(ORDER_NODES),
    );

    expect(result).toEqual({ ok: true, value: { order_id: "ord_1001" } });
  });

  it("reads an attribute and applies a pattern", () => {
    const nodes = [
      node({
        role: "link",
        name: "Everyday Tee",
        properties: { url: "/p/p_101" },
      }),
    ];

    const result = extract(
      {
        kind: "fields",
        fields: { id: { role: "link", attr: "href", pattern: "/p/([^/]+)$" } },
      },
      view(nodes),
    );

    expect(result).toEqual({ ok: true, value: { id: "p_101" } });
  });

  it("extracts rows in document order", () => {
    const result = extract(
      {
        kind: "rows",
        container: { test_id: "cart-table" },
        row: { test_id: "cart-row" },
        cols: {
          name: { role: "link" },
          qty: { role: "spinbutton", attr: "value" },
          total: { role: "cell", ordinal: 0 },
        },
      },
      view(CART_NODES),
    );

    expect(result).toEqual({
      ok: true,
      value: [{ name: "Everyday Tee", qty: 1, total: "$24.00" }],
    });
  });

  it("combines fields and rows", () => {
    const result = extract(
      {
        kind: "composite",
        fields: { order_id: { test_id: "order-id", attr: "text" } },
        rows: {
          as: "items",
          container: { test_id: "cart-table" },
          row: { test_id: "cart-row" },
          cols: { name: { role: "link" } },
        },
      },
      view([...ORDER_NODES, ...CART_NODES]),
    );

    expect(result).toEqual({
      ok: true,
      value: { order_id: "ord_1001", items: [{ name: "Everyday Tee" }] },
    });
  });

  it("returns an empty object for none", () => {
    expect(extract({ kind: "none" }, view([]))).toEqual({ ok: true, value: {} });
  });

  it("rejects a missing field", () => {
    const result = extract(
      { kind: "fields", fields: { nope: { role: "button", name: "Nope" } } },
      view([]),
    );

    expect(result).toMatchObject({ ok: false, message: 'field "nope" did not resolve' });
  });

  it("rejects a missing row column", () => {
    const result = extract(
      {
        kind: "rows",
        container: { test_id: "cart-table" },
        row: { test_id: "cart-row" },
        cols: { nope: { role: "button", name: "Nope" } },
      },
      view(CART_NODES),
    );

    expect(result).toMatchObject({ ok: false, message: 'row column "nope" did not resolve' });
  });

  it("rejects download extractors", () => {
    expect(extract({ kind: "download" }, view([]))).toMatchObject({ ok: false });
  });
});

describe("validateReturns", () => {
  const op = opDef({
    returns: {
      type: "array",
      items: {
        type: "object",
        properties: { qty: { type: "integer" } },
        required: ["qty"],
        additionalProperties: false,
      },
    },
  });

  it("coerces a numeric string to an integer", () => {
    const value = [{ qty: "1" }];
    const result = validateReturns(op, value);

    expect(result).toEqual({ ok: true, value: [{ qty: 1 }] });
  });

  it("rejects a value that does not match the schema", () => {
    const result = validateReturns(op, [{ qty: "many" }]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).toContain("did not validate");
  });
});

describe("checkPost", () => {
  const map: SiteMap = {
    site: "test",
    origins: ["http://x"],
    version: 1,
    states: [{ id: "home", url: "/", marks: [{ role: "heading", name: "Home" }] }],
    ops: [],
    entities: {},
    compiled_from: [],
    verified_at: "2026-11-08T00:00:00Z",
  };

  const home = view([node({ role: "heading", name: "Home" })], "http://x/");
  const order = view([], "http://x/orders/ord_1");
  const buttons = view([node({ role: "button", name: "Place order" })]);

  it("checks a state", () => {
    expect(checkPost({ kind: "state", state: "home" }, map, home)).toBeUndefined();
    expect(checkPost({ kind: "state", state: "other" }, map, home)).toContain("expected state");
  });

  it("checks a url pattern", () => {
    const filtered = view([], "http://x/orders?range=30d&page=2");
    expect(
      checkPost(
        { kind: "url", pattern: "^/orders$", search: "(^|&)range=30d(&|$)" },
        map,
        filtered,
      ),
    ).toBeUndefined();
    expect(
      checkPost({ kind: "url", pattern: "^/orders$", search: "(^|&)range=7d(&|$)" }, map, filtered),
    ).toContain("did not match");
    expect(checkPost({ kind: "url", pattern: "^/orders/ord_" }, map, order)).toBeUndefined();
    expect(checkPost({ kind: "url", pattern: "^/orders/ord_" }, map, home)).toContain(
      "did not match",
    );
  });

  it("checks exists and absent", () => {
    expect(
      checkPost({ kind: "exists", locator: { role: "button", name: "Place order" } }, map, buttons),
    ).toBeUndefined();
    expect(
      checkPost({ kind: "exists", locator: { role: "button", name: "Nope" } }, map, buttons),
    ).toContain("exist");
    expect(
      checkPost({ kind: "absent", locator: { role: "button", name: "Nope" } }, map, buttons),
    ).toBeUndefined();
    expect(
      checkPost({ kind: "absent", locator: { role: "button", name: "Place order" } }, map, buttons),
    ).toContain("absent");
  });

  it("checks text", () => {
    expect(
      checkPost(
        { kind: "text", locator: { role: "button", name: "Place order" }, contains: "Place" },
        map,
        buttons,
      ),
    ).toBeUndefined();
    expect(
      checkPost(
        { kind: "text", locator: { role: "button", name: "Place order" }, contains: "Nope" },
        map,
        buttons,
      ),
    ).toContain("expected text");
  });
});
