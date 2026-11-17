import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMap } from "@abubakarsiddiik/protocol";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const DRIFT = JSON.parse(readFileSync(join(ROOT, "bench/results/drift.json"), "utf8")) as {
  frozen_commit: string;
  model: string;
  before: Record<string, boolean>;
  after_switch: Record<string, boolean>;
  after_repair: Record<string, boolean>;
  repairs: Array<{ op: string; repaired: boolean; verified?: boolean }>;
  repair_rate: number;
  duplicate_writes: number;
  drift_day_success: number;
};
const FREEZE = JSON.parse(readFileSync(join(ROOT, "bench/results/freeze.json"), "utf8")) as {
  commit: string;
};

describe("drift run", () => {
  it("records the repair rate, duplicate writes, and drift-day success", () => {
    expect(DRIFT.repair_rate).toBe(1);
    expect(DRIFT.duplicate_writes).toBe(0);
    expect(DRIFT.drift_day_success).toBe(1);
  });

  it("passes on v1, fails after the switch, and passes after repair", () => {
    expect(Object.values(DRIFT.before).every(Boolean)).toBe(true);
    expect(Object.values(DRIFT.after_switch).every((value) => value === false)).toBe(true);
    expect(Object.values(DRIFT.after_repair).every(Boolean)).toBe(true);
  });

  it("ties the run to the frozen commit and model", () => {
    expect(DRIFT.frozen_commit).toBe(FREEZE.commit);
    expect(DRIFT.model).toBe("scripted");
    expect(DRIFT.repairs).toHaveLength(3);
    expect(DRIFT.repairs.every((repair) => repair.repaired && repair.verified === true)).toBe(true);
  });

  it("publishes the repaired search route and the create outcome check", () => {
    const library = parseMap(readFileSync(join(ROOT, "maps/heldout/library/v5.json"), "utf8"));
    const search = library.ops.find((op) => op.name === "search");
    expect(search?.impls[0]).toMatchObject({ tier: "url", route: "/catalog?q={query}" });

    const support = parseMap(readFileSync(join(ROOT, "maps/heldout/support/v7.json"), "utf8"));
    const create = support.ops.find((op) => op.name === "create_ticket");
    expect(create?.impls[0]?.tier).toBe("http");
    expect(create?.outcome_check).toBe("list_tickets");
  });
});
