import type { OpDef } from "@abubakarsiddiik/protocol";
import type { TraceAct } from "@abubakarsiddiik/runtime";
import type { Effect, NetworkEffect } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { liftHttp, withHttpLift } from "./http.js";
import type { ParameterizedSegment } from "./parameterize.js";
import { inferJsonReturns } from "./returns.js";

function act(effects: Effect[]): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: "e1",
    do: "click",
    doc: 1,
    v: 1,
    url: "http://shop.test/cart",
    effects,
    delta: { navigation: false, entries: [] },
  };
}

function request(input: {
  method: string;
  url: string;
  request_body?: unknown;
  response_body?: unknown;
  status?: number;
}): NetworkEffect {
  return {
    kind: "network",
    method: input.method,
    url: input.url,
    status: input.status ?? 200,
    mime_type: "application/json",
    ...(input.request_body !== undefined ? { request_body: input.request_body } : {}),
    ...(input.response_body !== undefined ? { response_body: input.response_body } : {}),
  };
}

function segment(acts: TraceAct[]): ParameterizedSegment {
  return {
    segment: {
      index: 0,
      start: 0,
      end: acts.length - 1,
      url: "http://shop.test/cart",
      actions: acts,
      reason: "test",
    },
    op: "add_to_cart",
    params: [
      { name: "product_id", value: "p_101", source: "url" },
      { name: "variant_id", value: "v_101_m_blue", source: "label", action: 0 },
      { name: "qty", value: 1, source: "label", action: 1 },
    ],
    constants: [],
    missing: [],
    schema: {},
  };
}

describe("liftHttp", () => {
  it("rebuilds the write request with param placeholders", () => {
    const lift = liftHttp({
      segment: segment([
        act([
          request({
            method: "POST",
            url: "http://shop.test/api/cart/items",
            request_body: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
            response_body: { ok: true, cart_count: 1 },
          }),
        ]),
      ]),
      returns: inferJsonReturns({ ok: true, cart_count: 1 }),
      outcomeCheck: "view_cart",
    });

    expect(lift).toMatchObject({
      steps: [
        {
          method: "POST",
          url: "/api/cart/items",
          headers: { "content-type": "application/json" },
          body: { product_id: "{product_id}", variant_id: "{variant_id}", qty: "{qty}" },
        },
      ],
      outcome_check: "view_cart",
    });
    expect(lift?.params.sort()).toEqual(["product_id", "qty", "variant_id"]);
  });

  it("binds a value from one response into the next request", () => {
    const lift = liftHttp({
      segment: segment([
        act([
          request({
            method: "POST",
            url: "http://shop.test/api/session",
            request_body: {},
            response_body: { csrf: "abc123" },
          }),
        ]),
        act([
          request({
            method: "POST",
            url: "http://shop.test/api/order",
            request_body: { csrf: "abc123", item: "p_101" },
            response_body: { ok: true },
          }),
        ]),
      ]),
      returns: inferJsonReturns({ ok: true }),
    });

    expect(lift?.steps[0]).toMatchObject({ bind: { csrf: "csrf" } });
    expect(lift?.steps[1]).toMatchObject({ body: { csrf: "{csrf}", item: "{product_id}" } });
  });

  it("ignores a segment with no successful write request", () => {
    expect(
      liftHttp({
        segment: segment([act([request({ method: "GET", url: "http://shop.test/api/cart" })])]),
        returns: inferJsonReturns({ ok: true }),
      }),
    ).toBeUndefined();
  });
});

describe("withHttpLift", () => {
  it("replaces the http impl and records the outcome check", () => {
    const op: OpDef = {
      name: "add_to_cart",
      version: 1,
      summary: "Add a variant to the cart.",
      params: { type: "object" },
      returns: { type: "object" },
      from: ["product"],
      to: ["cart"],
      post: [],
      effect: "write",
      status: "verified",
      impls: [{ tier: "ui", steps: [], extract: { kind: "none" } }],
    };

    const lifted = withHttpLift(
      op,
      {
        steps: [{ method: "POST", url: "/api/cart/items", body: { qty: "{qty}" } }],
        extract: { kind: "json", path: "" },
        params: ["qty"],
      },
      { type: "object" },
      "view_cart",
    );

    expect(lifted.outcome_check).toBe("view_cart");
    expect(lifted.impls[0]).toEqual({
      tier: "http",
      steps: [{ method: "POST", url: "/api/cart/items", body: { qty: "{qty}" } }],
      extract: { kind: "json", path: "" },
    });
    expect(lifted.impls).toHaveLength(2);
    expect(lifted.impls[1]).toMatchObject({ tier: "ui" });
  });
});
