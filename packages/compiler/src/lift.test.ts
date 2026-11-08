import type { OpDef } from "@portolan/protocol";
import { describe, expect, it } from "vitest";

import { liftUrl, withUrlLift } from "./lift.js";
import type { ParameterizedSegment } from "./parameterize.js";
import type { InferredReturns } from "./returns.js";

const RETURNS: InferredReturns = {
  kind: "none",
  extractor: { kind: "none" },
  value: {},
  schema: { type: "object", properties: {}, additionalProperties: false },
};

function segment(url: string, params: ParameterizedSegment["params"]): ParameterizedSegment {
  return {
    segment: { index: 0, start: 0, end: 0, url, actions: [], reason: "test" },
    op: "search",
    params,
    constants: [],
    missing: [],
    schema: {},
  };
}

describe("liftUrl", () => {
  it("lifts a query param from the store search", () => {
    const lift = liftUrl({
      segment: segment("https://shop.test/search?q=tee", [
        { name: "query", value: "tee", source: "label", action: 0 },
      ]),
      returns: RETURNS,
    });

    expect(lift).toMatchObject({ route: "/search?q={query}", params: ["query"] });
  });

  it("drops the filter form's empty params", () => {
    const lift = liftUrl({
      segment: segment("https://portal.test/?q=&status=paid&category=", [
        { name: "status", value: "paid", source: "task", action: 3 },
      ]),
      returns: RETURNS,
    });

    expect(lift).toMatchObject({ route: "/?status={status}", params: ["status"] });
  });

  it("lifts a path param", () => {
    const lift = liftUrl({
      segment: segment("https://shop.test/p/p_101", [
        { name: "product_id", value: "p_101", source: "url" },
      ]),
      returns: RETURNS,
    });

    expect(lift).toMatchObject({ route: "/p/{product_id}", params: ["product_id"] });
  });

  it("refuses a segment whose params are not in the URL", () => {
    expect(
      liftUrl({
        segment: segment("https://shop.test/checkout", [
          { name: "card", value: "4242424242424242", source: "label", action: 4 },
        ]),
        returns: RETURNS,
      }),
    ).toBeUndefined();
  });
});

describe("withUrlLift", () => {
  it("replaces the url impl and sets the inferred returns", () => {
    const op: OpDef = {
      name: "search",
      version: 1,
      summary: "Search products.",
      params: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      returns: { type: "object" },
      from: ["catalog"],
      to: ["results"],
      post: [{ kind: "state", state: "results" }],
      effect: "read",
      status: "verified",
      impls: [{ tier: "url", route: "/old", extract: { kind: "none" } }],
    };

    const lift = { route: "/search?q={query}", extract: RETURNS.extractor, params: ["query"] };
    const lifted = withUrlLift(op, lift, { type: "array" });

    expect(lifted.returns).toEqual({ type: "array" });
    expect(lifted.impls[0]).toEqual({
      tier: "url",
      route: "/search?q={query}",
      extract: { kind: "none" },
    });
    expect(lifted.impls).toHaveLength(1);
  });
});
