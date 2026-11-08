import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMap, type SiteMap } from "@portolan/protocol";
import type { SemanticNode, Snapshot } from "@portolan/substrate";
import { describe, expect, it } from "vitest";

import { matchesLocator, matchingNodes, matchUrl, recognizeState } from "./state.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function map(site: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, site, "v1.json"), "utf8"));
}

function node(partial: Partial<SemanticNode> & Pick<SemanticNode, "role">): SemanticNode {
  return {
    nodeId: partial.nodeId ?? `${partial.role}:${partial.name ?? ""}`,
    role: partial.role,
    name: partial.name ?? "",
    ignored: false,
    visible: partial.visible ?? true,
    properties: {},
    childIds: [],
    ...(partial.test_id !== undefined ? { test_id: partial.test_id } : {}),
    ...(partial.backendNodeId !== undefined ? { backendNodeId: partial.backendNodeId } : {}),
    ...(partial.bounds !== undefined ? { bounds: partial.bounds } : {}),
  };
}

function snapshot(url: string, nodes: SemanticNode[]): Snapshot {
  return { doc: 1, v: 0, url, title: "", nodes };
}

describe("store states", () => {
  const store = map("store");

  it("recognizes the catalog", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/", [node({ role: "textbox", name: "Search products" })]),
    );

    expect(match?.state.id).toBe("catalog");
  });

  it("recognizes search results", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/search?q=tee", [node({ role: "generic", test_id: "product-grid" })]),
    );

    expect(match?.state.id).toBe("results");
  });

  it("recognizes a product", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/p/p_101", [node({ role: "article", test_id: "product-detail" })]),
    );

    expect(match?.state.id).toBe("product");
  });

  it("recognizes the cart", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/cart", [node({ role: "heading", name: "Your cart" })]),
    );

    expect(match?.state.id).toBe("cart");
  });

  it("recognizes checkout", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/checkout", [node({ role: "button", name: "Place order" })]),
    );

    expect(match?.state.id).toBe("checkout");
  });

  it("recognizes an order", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/orders/ord_1", [node({ role: "strong", test_id: "order-id" })]),
    );

    expect(match?.state.id).toBe("order");
  });

  it("returns undefined when the URL matches but marks are missing", () => {
    const match = recognizeState(
      store,
      snapshot("http://x/search", [node({ role: "heading", name: "Results" })]),
    );

    expect(match).toBeUndefined();
  });
});

describe("portal states", () => {
  const portal = map("portal");

  it("recognizes login", () => {
    const match = recognizeState(
      portal,
      snapshot("http://x/login", [node({ role: "button", name: "Sign in" })]),
    );

    expect(match?.state.id).toBe("login");
  });

  it("recognizes the ledger", () => {
    const match = recognizeState(
      portal,
      snapshot("http://x/", [node({ role: "table", test_id: "invoice-table" })]),
    );

    expect(match?.state.id).toBe("invoices");
  });

  it("does not confuse the ledger with login", () => {
    const match = recognizeState(
      portal,
      snapshot("http://x/", [node({ role: "button", name: "Sign in" })]),
    );

    expect(match).toBeUndefined();
  });
});

describe("wizard states", () => {
  const wizard = map("wizard");

  it("recognizes every step", () => {
    const cases = [
      ["http://x/step/1", "heading", "Tell us about you", "step1"],
      ["http://x/step/2", "heading", "Tell us about your team", "step2"],
      ["http://x/step/3", "heading", "Review and upload", "step3"],
      ["http://x/done/sub_1", "strong", "submission-id", "done"],
    ] as const;

    for (const [url, role, name, expected] of cases) {
      const nodes = expected === "done" ? [node({ role, test_id: name })] : [node({ role, name })];

      expect(recognizeState(wizard, snapshot(url, nodes))?.state.id).toBe(expected);
    }
  });
});

describe("matchingNodes", () => {
  const nodes = [
    node({ role: "button", name: "Add to cart" }),
    node({ role: "button", name: "Add to wishlist" }),
    node({ role: "textbox", name: "Search products" }),
    node({ role: "heading", name: "Search products" }),
    node({ role: "button", name: "Hidden", visible: false }),
  ];

  it("matches role and name", () => {
    expect(matchingNodes(nodes, { role: "button", name: "Add to cart" })).toHaveLength(1);
  });

  it("matches name_re", () => {
    expect(matchingNodes(nodes, { role: "button", name_re: "^Add to" })).toHaveLength(2);
  });

  it("selects by ordinal", () => {
    const selected = matchingNodes(nodes, {
      role: "button",
      name_re: "^Add to",
      ordinal: 1,
    });

    expect(selected[0]?.name).toBe("Add to wishlist");
  });

  it("matches a form control by label", () => {
    const selected = matchingNodes(nodes, { label: "Search products" });

    expect(selected[0]?.role).toBe("textbox");
  });

  it("ignores invisible nodes", () => {
    expect(matchesLocator(nodes, { role: "button", name: "Hidden" })).toBe(false);
  });
});

describe("specificity", () => {
  const custom: SiteMap = {
    site: "test",
    origins: ["http://x"],
    version: 1,
    states: [
      { id: "base", url: "/", marks: [{ role: "heading", name: "Home" }] },
      {
        id: "specific",
        url: "/",
        marks: [{ role: "heading", name: "Home" }, { test_id: "detail" }],
      },
    ],
    ops: [],
    entities: {},
    compiled_from: [],
    verified_at: "2026-11-08T00:00:00Z",
  };

  it("prefers the state with more marks", () => {
    const match = recognizeState(
      custom,
      snapshot("http://x/", [
        node({ role: "heading", name: "Home" }),
        node({ role: "generic", test_id: "detail" }),
      ]),
    );

    expect(match?.state.id).toBe("specific");
  });

  it("falls back to the base state", () => {
    const match = recognizeState(
      custom,
      snapshot("http://x/", [node({ role: "heading", name: "Home" })]),
    );

    expect(match?.state.id).toBe("base");
  });

  it("rejects a state whose not locator is present", () => {
    const guest: SiteMap = {
      ...custom,
      states: [
        {
          id: "guest",
          url: "/",
          marks: [{ role: "heading", name: "Home" }],
          not: [{ test_id: "user-menu" }],
        },
      ],
    };

    const match = recognizeState(
      guest,
      snapshot("http://x/", [
        node({ role: "heading", name: "Home" }),
        node({ role: "generic", test_id: "user-menu" }),
      ]),
    );

    expect(match).toBeUndefined();
  });
});

describe("matchUrl", () => {
  it("matches exact paths", () => {
    expect(matchUrl("/", "http://x/")).toBe(true);
    expect(matchUrl("/cart", "http://x/cart")).toBe(true);
    expect(matchUrl("/cart", "http://x/checkout")).toBe(false);
  });

  it("matches a named segment", () => {
    expect(matchUrl("/p/:id", "http://x/p/p_101")).toBe(true);
    expect(matchUrl("/p/:id", "http://x/p/")).toBe(false);
    expect(matchUrl("/p/:id", "http://x/p/p_101/extra")).toBe(false);
  });

  it("ignores the query string", () => {
    expect(matchUrl("/search", "http://x/search?q=tee")).toBe(true);
  });
});
