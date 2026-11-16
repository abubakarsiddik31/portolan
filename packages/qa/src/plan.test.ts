import { describe, expect, it } from "vitest";

import { planCases } from "./plan.js";

const CASES = [
  { id: "auth/login", status: "verified", tags: ["smoke"], touches: ["src/auth/**"] },
  { id: "cart/add", status: "verified", tags: [], touches: ["src/cart/**"] },
  { id: "profile/edit", status: "disabled", tags: [], touches: ["src/profile/**"] },
  { id: "flaky/search", status: "quarantined", tags: [], touches: ["src/search/**"] },
  { id: "no/touch", status: "verified", tags: [], touches: [] },
];

describe("planCases", () => {
  it("selects smoke cases and cases whose touches match the diff", () => {
    const plan = planCases({ cases: CASES, changedFiles: ["src/cart/line.ts"] });
    expect(plan.selected).toEqual(["auth/login", "cart/add"]);
  });

  it("skips disabled and quarantined cases", () => {
    const plan = planCases({
      cases: CASES,
      changedFiles: ["src/profile/x.ts", "src/search/y.ts"],
    });
    expect(plan.selected).toEqual(["auth/login"]);
    expect(plan.reasons.some((item) => item.reasons.includes("skip:quarantined"))).toBe(true);
  });

  it("includes quarantined cases only when asked", () => {
    const plan = planCases({
      cases: CASES,
      changedFiles: ["src/search/y.ts"],
      includeQuarantined: true,
    });
    expect(plan.selected).toContain("flaky/search");
  });

  it("reports what the cap dropped", () => {
    const plan = planCases({ cases: CASES, changedFiles: ["src/cart/x.ts"], max: 1 });
    expect(plan.selected).toHaveLength(1);
    expect(plan.omitted).toHaveLength(1);
  });

  it("selects nothing when the diff is empty, even for smoke", () => {
    const plan = planCases({ cases: CASES, changedFiles: [] });
    expect(plan.selected).toEqual([]);
  });

  it("never selects a case with no touches unless it is smoke", () => {
    const plan = planCases({ cases: CASES, changedFiles: ["src/auth/x.ts"], includeSmoke: false });
    expect(plan.selected).toEqual(["auth/login"]);
    expect(plan.selected).not.toContain("no/touch");
  });
});
