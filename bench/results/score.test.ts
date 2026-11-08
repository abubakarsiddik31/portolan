import { describe, expect, it } from "vitest";

import { makeRunResult, type RunInput } from "./schema.js";
import { bootstrapInterval, renderFinalTable, scoreByArm } from "./score.js";

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    run_id: "run-1",
    task_id: "template-a#1",
    template_id: "template-a",
    site: "library",
    arm: "B",
    provider: "test",
    model: "test",
    started_at: "2026-11-09T00:00:00.000Z",
    duration_ms: 1000,
    steps: 10,
    success: true,
    usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, cost_usd: 0.01 },
    ...overrides,
  };
}

describe("score", () => {
  it("bootstraps deterministically from a seed", () => {
    const first = bootstrapInterval([0, 1], { resamples: 500, seed: 7 });
    const second = bootstrapInterval([0, 1], { resamples: 500, seed: 7 });

    expect(first).toEqual(second);
    expect(first.estimate).toBe(0.5);
    expect(first.lower).toBeLessThanOrEqual(0.5);
    expect(first.upper).toBeGreaterThanOrEqual(0.5);
  });

  it("weights templates equally, not runs", () => {
    const results = [
      makeRunResult(input({ run_id: "1", success: true })),
      makeRunResult(input({ run_id: "2", success: false })),
      makeRunResult(input({ run_id: "3", success: false })),
      makeRunResult(input({ run_id: "4", template_id: "template-b", task_id: "template-b#1" })),
    ];

    const [arm] = scoreByArm(results, { resamples: 100, seed: 1 });

    expect(arm?.templates).toHaveLength(2);
    expect(arm?.runs).toBe(4);
    expect(arm?.successRate.estimate).toBeCloseTo((1 / 3 + 1) / 2);
  });

  it("renders the final table with confidence intervals", () => {
    const results = [
      makeRunResult(input({ run_id: "1", success: true })),
      makeRunResult(input({ run_id: "2", success: false })),
      makeRunResult(input({ run_id: "3", template_id: "template-b", task_id: "template-b#1" })),
    ];

    const table = renderFinalTable(results, { resamples: 100, seed: 1 });

    expect(table).toContain("| Arm | Runs | Templates | Success (95% CI)");
    expect(table).toContain("| B | 3 | 2 |");
  });

  it("shows an em dash when no template completed", () => {
    const table = renderFinalTable([makeRunResult(input({ success: false }))], {
      resamples: 50,
      seed: 1,
    });

    expect(table).toContain("—");
  });
});
