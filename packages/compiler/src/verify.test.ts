import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import { describe, expect, it } from "vitest";

import { pool } from "./pool.js";
import { distinctSets, minParamSets, verifyOp } from "./verify.js";

const MAP = {
  site: "test",
  version: 1,
  origins: ["http://127.0.0.1:1"],
  states: [],
  ops: [],
  entities: [],
} as unknown as SiteMap;

const OP = {
  name: "search",
  version: 1,
  summary: "Search.",
  params: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  returns: { type: "object" },
  from: ["catalog"],
  to: ["results"],
  post: [],
  effect: "read",
  status: "verified",
  impls: [],
} as unknown as OpDef;

describe("verifyOp", () => {
  it("rejects fewer than three param sets before launching a browser", async () => {
    const report = await verifyOp({
      map: MAP,
      op: OP,
      paramSets: [{ query: "a" }, { query: "b" }],
      executablePath: "/does/not/exist",
    });

    expect(report).toMatchObject({
      op: "search",
      verified: false,
      impls: [],
      reason: "at least 3 param sets are required",
    });
  });
});

describe("param sets", () => {
  it("runs identical sets once and asks for one set when nothing is required", () => {
    expect(distinctSets([{}, {}, {}])).toEqual([{}]);
    expect(
      distinctSets([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
        { a: 1, b: 3 },
      ]),
    ).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
    ]);

    expect(minParamSets({ ...OP, params: { type: "object" } } as OpDef)).toBe(1);
    expect(minParamSets(OP)).toBe(3);
  });

  it("accepts a single empty set for an op with no required params", async () => {
    const report = await verifyOp({
      map: MAP,
      op: { ...OP, params: { type: "object" } } as OpDef,
      paramSets: [{}],
      executablePath: "/does/not/exist",
    }).catch((error: Error) => error);

    // It got as far as launching a browser, which is the point.
    expect(String(report)).toContain("Failed to launch");
  });
});

describe("pool", () => {
  it("keeps results in order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;

    const results = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
    expect(await pool([], 4, async () => 1)).toEqual([]);
  });
});
