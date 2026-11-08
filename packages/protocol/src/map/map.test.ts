import { describe, expect, it } from "vitest";
import type { SiteMap } from "../index.js";
import { loadMap, MAP_SCHEMA, MapValidationError, parseMap } from "../index.js";

/** A small but complete map. Every field the schema allows is exercised. */
const STORE_MAP: SiteMap = {
  site: "store",
  origins: ["http://127.0.0.1:4100"],
  version: 1,
  states: [
    {
      id: "catalog",
      url: "/",
      marks: [{ role: "searchbox", name: "Search products" }],
    },
    {
      id: "cart",
      url: "/cart",
      marks: [{ test_id: "cart-subtotal" }],
      not: [{ role: "searchbox", name: "Search products" }],
    },
    {
      id: "order",
      url: "/orders/:id",
      marks: [{ test_id: "order-id" }],
    },
  ],
  ops: [
    {
      name: "search",
      version: 1,
      summary: "Search products.",
      params: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      returns: { type: "array", items: { type: "object" } },
      from: ["catalog"],
      to: ["catalog"],
      post: [{ kind: "url", pattern: "^/search\\?q=" }],
      effect: "read",
      impls: [
        {
          tier: "url",
          route: "/search?q={query}",
          extract: {
            kind: "rows",
            container: { test_id: "product-grid" },
            row: { role: "article" },
            cols: {
              name: { role: "link" },
              price: { role: "paragraph", ordinal: 1 },
            },
          },
        },
      ],
      status: "verified",
    },
    {
      name: "view_cart",
      version: 1,
      summary: "Read the cart.",
      params: { type: "object", properties: {}, additionalProperties: false },
      returns: {
        type: "object",
        properties: { items: { type: "array" } },
        required: ["items"],
        additionalProperties: false,
      },
      from: ["catalog", "cart"],
      to: ["cart"],
      post: [{ kind: "state", state: "cart" }],
      effect: "read",
      impls: [
        {
          tier: "url",
          route: "/cart",
          extract: {
            kind: "rows",
            container: { test_id: "cart-table" },
            row: { test_id: "cart-row" },
            cols: {
              name: { role: "link" },
              qty: { role: "spinbutton", attr: "value" },
            },
          },
        },
      ],
      status: "verified",
    },
    {
      name: "add_to_cart",
      version: 1,
      summary: "Add a variant to the cart.",
      params: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          variant_id: { type: "string" },
          qty: { type: "integer", minimum: 1 },
        },
        required: ["product_id", "variant_id", "qty"],
        additionalProperties: false,
      },
      returns: {
        type: "object",
        properties: { items: { type: "array" } },
        required: ["items"],
        additionalProperties: false,
      },
      from: ["catalog"],
      to: ["cart"],
      post: [{ kind: "state", state: "cart" }],
      effect: "write",
      impls: [
        {
          tier: "ui",
          steps: [
            {
              do: "select",
              target: { role: "combobox", name: "Size / color" },
              value: "{variant_id}",
            },
            {
              do: "fill",
              target: { role: "spinbutton", name: "Quantity" },
              value: "{qty}",
            },
            { do: "click", target: { role: "button", name: "Add to cart" } },
            { do: "await_state", state: "cart" },
          ],
          extract: {
            kind: "rows",
            container: { test_id: "cart-table" },
            row: { test_id: "cart-row" },
            cols: { name: { role: "link" } },
          },
        },
      ],
      status: "verified",
    },
    {
      name: "checkout",
      version: 1,
      summary: "Place an order.",
      params: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          card: { type: "string" },
        },
        required: ["name", "email", "card"],
        additionalProperties: false,
      },
      returns: {
        type: "object",
        properties: { order_id: { type: "string" } },
        required: ["order_id"],
        additionalProperties: false,
      },
      from: ["cart"],
      to: ["order"],
      post: [{ kind: "url", pattern: "^/orders/ord_" }],
      effect: "irreversible",
      confirm: true,
      impls: [
        {
          tier: "ui",
          steps: [
            { do: "fill", target: { role: "textbox", name: "Full name" }, value: "{name}" },
            { do: "fill", target: { role: "textbox", name: "Email" }, value: "{email}" },
            { do: "fill", target: { role: "textbox", name: "Card number" }, value: "{card}" },
            { do: "click", target: { role: "button", name: "Place order" } },
            { do: "await_state", state: "order" },
          ],
          extract: {
            kind: "fields",
            fields: { order_id: { test_id: "order-id", attr: "text" } },
          },
        },
      ],
      status: "verified",
    },
  ],
  entities: {
    Product: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
      additionalProperties: false,
    },
  },
  compiled_from: [],
  verified_at: "2026-11-08T00:00:00Z",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function opAt(map: SiteMap, index: number): SiteMap["ops"][number] {
  const op = map.ops[index];
  if (op === undefined) throw new Error(`no op at ${index}`);
  return op;
}

function stateAt(map: SiteMap, index: number): SiteMap["states"][number] {
  const state = map.states[index];
  if (state === undefined) throw new Error(`no state at ${index}`);
  return state;
}

describe("site map schema", () => {
  it("declares a stable schema id", () => {
    expect(MAP_SCHEMA.$id).toBe("https://portolan.dev/schema/map-v0.json");
  });

  it("loads a complete map and returns it typed", () => {
    const map: SiteMap = loadMap(clone(STORE_MAP));

    expect(map.site).toBe("store");
    expect(map.ops.map((op) => op.name)).toEqual([
      "search",
      "view_cart",
      "add_to_cart",
      "checkout",
    ]);
  });

  it("parses JSON text", () => {
    const map = parseMap(JSON.stringify(STORE_MAP));
    expect(map.version).toBe(1);
  });

  it("rejects an unknown top-level field", () => {
    const map = { ...clone(STORE_MAP), extra: true };

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("rejects a site slug with capitals", () => {
    const map = { ...clone(STORE_MAP), site: "Store" };

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("rejects a locator with neither a role nor a test id", () => {
    const map = clone(STORE_MAP);
    stateAt(map, 0).marks = [{ name: "Search products" }];

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("rejects a locator with both name and name_re", () => {
    const map = clone(STORE_MAP);
    stateAt(map, 0).marks = [{ role: "searchbox", name: "a", name_re: "b" }];

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("rejects invalid JSON text", () => {
    expect(() => parseMap("{")).toThrow(MapValidationError);
  });
});

describe("map references", () => {
  it("rejects an unknown from state", () => {
    const map = clone(STORE_MAP);
    opAt(map, 0).from = ["nowhere"];

    expect(() => loadMap(map)).toThrow(/unknown state "nowhere"/);
  });

  it("rejects an unknown await_state", () => {
    const map = clone(STORE_MAP);
    const ui = opAt(map, 2).impls[0] as unknown as { steps: Array<Record<string, unknown>> };
    ui.steps[3] = { do: "await_state", state: "nowhere" };

    expect(() => loadMap(map)).toThrow(/unknown state "nowhere"/);
  });

  it("rejects duplicate state ids", () => {
    const map = clone(STORE_MAP);
    map.states.push(clone(stateAt(map, 0)));

    expect(() => loadMap(map)).toThrow(/duplicate state id/);
  });

  it("rejects duplicate op names", () => {
    const map = clone(STORE_MAP);
    map.ops.push(clone(opAt(map, 0)));

    expect(() => loadMap(map)).toThrow(/duplicate op name/);
  });

  it("rejects params that are not a valid JSON Schema", () => {
    const map = clone(STORE_MAP);
    opAt(map, 0).params = { type: "not-a-type" };

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });
});

describe("write safety", () => {
  it("rejects an irreversible op without confirm", () => {
    const map = clone(STORE_MAP);
    opAt(map, 3).confirm = false;

    expect(() => loadMap(map)).toThrow(/must set confirm: true/);
  });

  it("rejects an irreversible op with a url impl", () => {
    const map = clone(STORE_MAP);
    opAt(map, 3).impls = [
      {
        tier: "url",
        route: "/checkout?card={card}",
        extract: { kind: "fields", fields: { order_id: { test_id: "order-id" } } },
      },
    ];

    expect(() => loadMap(map)).toThrow(/may only use webmcp or ui impls/);
  });

  it("rejects a write op with an http impl and no outcome_check", () => {
    const map = clone(STORE_MAP);
    opAt(map, 2).impls = [
      {
        tier: "http",
        steps: [{ method: "POST", url: "/cart", body: { variant_id: "{variant_id}" } }],
        extract: { kind: "fields", fields: { items: { test_id: "cart-table" } } },
      },
    ];

    expect(() => loadMap(map)).toThrow(/need outcome_check/);
  });

  it("rejects a write op with a url impl", () => {
    const map = clone(STORE_MAP);
    opAt(map, 2).impls = [
      {
        tier: "url",
        route: "/cart/add?variant_id={variant_id}&qty={qty}",
        extract: { kind: "fields", fields: { items: { test_id: "cart-table" } } },
      },
    ];

    expect(() => loadMap(map)).toThrow(/may not use a url impl/);
  });

  it("accepts a write op with an http impl and a read outcome_check", () => {
    const map = clone(STORE_MAP);
    opAt(map, 2).impls = [
      {
        tier: "http",
        steps: [{ method: "POST", url: "/cart", body: { variant_id: "{variant_id}" } }],
        extract: { kind: "fields", fields: { items: { test_id: "cart-table" } } },
      },
    ];
    opAt(map, 2).outcome_check = "view_cart";

    expect(() => loadMap(map)).not.toThrow();
  });

  it("rejects an outcome_check that names a write op", () => {
    const map = clone(STORE_MAP);
    opAt(map, 2).outcome_check = "add_to_cart";

    expect(() => loadMap(map)).toThrow(/must name a read op/);
  });

  it("rejects an outcome_check that names a missing op", () => {
    const map = clone(STORE_MAP);
    opAt(map, 2).outcome_check = "does_not_exist";

    expect(() => loadMap(map)).toThrow(/unknown op "does_not_exist"/);
  });
});

describe("extractor shapes", () => {
  it("accepts a label locator for a form field", () => {
    const map = clone(STORE_MAP);
    opAt(map, 3).impls = [
      {
        tier: "ui",
        steps: [{ do: "fill", target: { label: "Full name" }, value: "{name}" }],
        extract: { kind: "none" },
      },
    ];

    expect(() => loadMap(map)).not.toThrow();
  });

  it("rejects a name without a role", () => {
    const map = clone(STORE_MAP);
    opAt(map, 3).impls = [
      {
        tier: "ui",
        steps: [{ do: "click", target: { name: "Place order" } }],
        extract: { kind: "none" },
      },
    ];

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("accepts composite, download, and none extractors", () => {
    const map = clone(STORE_MAP);
    opAt(map, 1).impls = [
      {
        tier: "url",
        route: "/cart",
        extract: {
          kind: "composite",
          fields: { subtotal: { test_id: "cart-subtotal" } },
          rows: {
            as: "items",
            container: { test_id: "cart-table" },
            row: { test_id: "cart-row" },
            cols: { name: { role: "link" } },
          },
        },
      },
    ];
    opAt(map, 0).impls = [{ tier: "url", route: "/cart", extract: { kind: "download" } }];
    opAt(map, 3).impls = [
      {
        tier: "ui",
        steps: [{ do: "click", target: { label: "Sign in" } }],
        extract: { kind: "none" },
      },
    ];

    expect(() => loadMap(map)).not.toThrow();
  });

  it("rejects a composite with neither fields nor rows", () => {
    const map = clone(STORE_MAP);
    opAt(map, 1).impls = [
      {
        tier: "url",
        route: "/cart",
        extract: { kind: "composite" } as never,
      },
    ];

    expect(() => loadMap(map)).toThrow(MapValidationError);
  });

  it("rejects an invalid locator pattern", () => {
    const map = clone(STORE_MAP);
    opAt(map, 0).impls = [
      {
        tier: "url",
        route: "/search?q={query}",
        extract: {
          kind: "fields",
          fields: { id: { role: "link", attr: "href", pattern: "(" } },
        },
      },
    ];

    expect(() => loadMap(map)).toThrow(/invalid regular expression/);
  });
});
