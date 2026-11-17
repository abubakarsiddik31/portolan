import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import { describe, expect, it } from "vitest";

import { verifyOp } from "./verify.js";

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
  params: { type: "object" },
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
