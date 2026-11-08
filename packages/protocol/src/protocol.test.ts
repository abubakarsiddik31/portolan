import { describe, expect, it } from "vitest";

import {
  callRequestSchema,
  ERROR_CODES,
  ERROR_DESCRIPTIONS,
  errorCodeSchema,
  meterSchema,
  openSiteRequestSchema,
  protocolError,
  protocolErrorSchema,
  resultEnvelopeSchema,
  sessionSchema,
} from "./index.js";

describe("result envelope", () => {
  it("round-trips a successful result", () => {
    const envelope = {
      ok: true as const,
      result: { orderId: "ord_1001" },
      meter: { ms: 42 },
    };

    expect(resultEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("round-trips an error with structured details", () => {
    const envelope = {
      ok: false as const,
      error: {
        code: "precondition_failed" as const,
        message: "session is in catalog, not cart",
        details: { current_state: "catalog", route: ["search", "add_to_cart"] },
      },
      meter: { ms: 3 },
    };

    expect(resultEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects an unknown error code", () => {
    const result = resultEnvelopeSchema.safeParse({
      ok: false,
      error: { code: "something_else", message: "nope" },
    });

    expect(result.success).toBe(false);
  });

  it("requires a message on every error", () => {
    expect(protocolErrorSchema.safeParse({ code: "timeout" }).success).toBe(false);
  });
});

describe("error codes", () => {
  it("has a description for every code", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_DESCRIPTIONS[code]).toBeTypeOf("string");
      expect(ERROR_DESCRIPTIONS[code].length).toBeGreaterThan(0);
    }
  });

  it("accepts every declared code and nothing else", () => {
    for (const code of ERROR_CODES) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
    expect(errorCodeSchema.safeParse("not_a_code").success).toBe(false);
  });

  it("builds an error without details when none are given", () => {
    expect(protocolError("timeout", "too slow")).toEqual({
      code: "timeout",
      message: "too slow",
    });
  });
});

describe("meter", () => {
  it("accepts a latency-only meter", () => {
    expect(meterSchema.parse({ ms: 0 })).toEqual({ ms: 0 });
  });

  it("rejects a negative latency", () => {
    expect(meterSchema.safeParse({ ms: -1 }).success).toBe(false);
  });

  it("rejects fractional tokens", () => {
    expect(meterSchema.safeParse({ ms: 1, input_tokens: 1.5 }).success).toBe(false);
  });
});

describe("requests", () => {
  it("accepts a call without params", () => {
    expect(callRequestSchema.parse({ op: "view_cart" })).toEqual({ op: "view_cart" });
  });

  it("keeps an idempotency key and confirm flag", () => {
    const request = {
      op: "checkout",
      params: { name: "Ada" },
      idempotency_key: "order-42",
      confirm: true,
    };
    expect(callRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects an empty op name", () => {
    expect(callRequestSchema.safeParse({ op: "" }).success).toBe(false);
  });

  it("rejects an empty site name", () => {
    expect(openSiteRequestSchema.safeParse({ site: "" }).success).toBe(false);
  });

  it("requires a positive map version on a session", () => {
    expect(sessionSchema.safeParse({ sid: "s1", site: "store", map_version: 0 }).success).toBe(
      false,
    );
  });
});
