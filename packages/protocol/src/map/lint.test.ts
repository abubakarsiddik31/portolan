import { describe, expect, it } from "vitest";
import type { SiteMap } from "../index.js";
import { assertPortable, lintMap, lintToolName, MapLintError, toolName } from "../index.js";

const MINIMAL: SiteMap = {
  site: "store",
  origins: ["http://127.0.0.1:4100"],
  version: 1,
  states: [{ id: "home", url: "/", marks: [{ role: "link", name: "Home" }] }],
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
      from: ["home"],
      to: ["home"],
      post: [{ kind: "url", pattern: "^/search" }],
      effect: "read",
      impls: [
        {
          tier: "url",
          route: "/search?q={query}",
          extract: { kind: "fields", fields: { q: { role: "searchbox" } } },
        },
      ],
      status: "verified",
    },
  ],
  entities: {},
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

describe("portable lint", () => {
  it("accepts a portable map", () => {
    expect(lintMap(clone(MINIMAL))).toEqual([]);
  });

  it("requires an object at the params root", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).params.type = "array";

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({ rule: "portable/root-object", severity: "error" }),
    );
  });

  it("requires additionalProperties: false", () => {
    const map = clone(MINIMAL);
    delete opAt(map, 0).params.additionalProperties;

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({ rule: "portable/closed-object" }),
    );
  });

  it("rejects a root oneOf", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).params.oneOf = [{ type: "object" }];

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({ rule: "portable/no-root-union" }),
    );
  });

  it("requires every property to be listed in required", () => {
    const map = clone(MINIMAL);
    (opAt(map, 0).params.properties as Record<string, unknown>).extra = {
      type: "string",
    };

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({
        rule: "portable/required-complete",
        path: "/ops/0/params/required",
      }),
    );
  });

  it("rejects $ref in params", () => {
    const map = clone(MINIMAL);
    (opAt(map, 0).params.properties as Record<string, unknown>).query = {
      $ref: "#/$defs/query",
    };

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({
        rule: "portable/no-ref",
        path: "/ops/0/params/properties/query/$ref",
      }),
    );
  });

  it("rejects $ref in returns", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).returns.items = { $ref: "#/$defs/row" };

    expect(lintMap(map)).toContainEqual(expect.objectContaining({ rule: "portable/no-ref" }));
  });

  it("rejects format-dependent params", () => {
    const map = clone(MINIMAL);
    (opAt(map, 0).params.properties as Record<string, unknown>).query = {
      type: "string",
      format: "email",
    };

    expect(lintMap(map)).toContainEqual(expect.objectContaining({ rule: "portable/no-format" }));
  });

  it("allows format in returns", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).returns.items = { type: "string", format: "date-time" };

    expect(lintMap(map)).toEqual([]);
  });

  it("requires a one-line summary", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).summary = "Search products.\nThen open one.";

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({ rule: "op/summary-single-line" }),
    );
  });

  it("rejects a double underscore in an op name", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).name = "add__to_cart";

    expect(lintMap(map)).toContainEqual(expect.objectContaining({ rule: "tool/separator" }));
  });

  it("rejects a tool name longer than 64 characters", () => {
    const map = clone(MINIMAL);
    map.site = "a".repeat(60);

    expect(lintMap(map)).toContainEqual(expect.objectContaining({ rule: "tool/name" }));
  });

  it("does not warn about a missing post-check for an http op", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).post = [];
    opAt(map, 0).impls = [
      {
        tier: "http",
        steps: [{ method: "GET", url: "/api" }],
        extract: { kind: "json" },
      },
    ];

    expect(lintMap(map)).toEqual([]);
  });

  it("warns when an op has no post-check", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).post = [];

    expect(lintMap(map)).toContainEqual(
      expect.objectContaining({ rule: "op/no-post", severity: "warning" }),
    );
  });
});

describe("tool names", () => {
  it("joins site and op with a double underscore", () => {
    expect(toolName("store", "add_to_cart")).toBe("store__add_to_cart");
  });

  it("accepts the portable character set", () => {
    expect(lintToolName("store__add_to_cart")).toEqual([]);
    expect(lintToolName("my-site__op-2")).toEqual([]);
  });

  it("rejects dots, spaces, and long names", () => {
    expect(lintToolName("store.add")).toContainEqual(
      expect.objectContaining({ rule: "tool/name" }),
    );
    expect(lintToolName("a".repeat(65))).toContainEqual(
      expect.objectContaining({ rule: "tool/name" }),
    );
  });
});

describe("assertPortable", () => {
  it("returns warnings without throwing", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).post = [];

    expect(() => assertPortable(map)).not.toThrow();
    expect(assertPortable(map)).toContainEqual(expect.objectContaining({ severity: "warning" }));
  });

  it("throws on an error and carries every issue", () => {
    const map = clone(MINIMAL);
    opAt(map, 0).params.type = "array";
    delete opAt(map, 0).params.additionalProperties;

    try {
      assertPortable(map);
      expect.unreachable("expected a lint error");
    } catch (error) {
      expect(error).toBeInstanceOf(MapLintError);
      expect((error as MapLintError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
