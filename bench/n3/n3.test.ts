import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderFinalTable } from "../results/score.js";
import { readResults } from "../results/store.js";

const ROOT = join(import.meta.dirname, "../..");
const results = readResults(join(ROOT, "bench/results/n3.jsonl"));

describe("N=3 raw results", () => {
  it("has three rows for every held-out template", () => {
    expect(results).toHaveLength(48);

    const byTemplate = new Map<string, number>();
    for (const result of results) {
      byTemplate.set(result.template_id, (byTemplate.get(result.template_id) ?? 0) + 1);
    }

    expect(byTemplate.size).toBe(16);
    expect([...byTemplate.values()].every((count) => count === 3)).toBe(true);
  });

  it("is arm C with the scripted model", () => {
    expect(results.every((result) => result.arm === "C")).toBe(true);
    expect(results.every((result) => result.provider === "scripted")).toBe(true);
    expect(results.every((result) => result.model === "scripted")).toBe(true);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it("regenerates the final table", () => {
    const table = renderFinalTable(results, { resamples: 100, seed: 1 });
    expect(table).toContain("| C | 48 | 16 |");
  });
});
