import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeRunResult, type RunInput } from "./schema.js";
import { writeFinalTable } from "./score.js";
import { appendResult, readResults } from "./store.js";
import { renderTable, summarizeByArm, writeTable } from "./table.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-results-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    run_id: "run-1",
    task_id: "store-buy-variant#1",
    template_id: "store-buy-variant",
    site: "store",
    arm: "B",
    provider: "anthropic",
    model: "test-model",
    started_at: "2026-11-08T00:00:00.000Z",
    duration_ms: 1000,
    steps: 10,
    success: true,
    usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, cost_usd: 0.01 },
    ...overrides,
  };
}

describe("run results", () => {
  it("adds browser cost to the total", () => {
    const result = makeRunResult(input({ browser_cost_usd: 0.02 }));
    expect(result.total_cost_usd).toBe(0.03);
  });

  it("round-trips through jsonl", () => {
    const file = join(tempDir(), "results.jsonl");
    appendResult(file, makeRunResult(input()));
    appendResult(file, makeRunResult(input({ run_id: "run-2", arm: "D-oracle", success: false })));

    const results = readResults(file);
    expect(results).toHaveLength(2);
    expect(results[0]?.arm).toBe("B");
    expect(results[1]?.arm).toBe("D-oracle");
  });

  it("summarizes cost per completed task, not per attempt", () => {
    const results = [
      makeRunResult(
        input({
          run_id: "1",
          success: true,
          duration_ms: 1000,
          steps: 10,
          usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, cost_usd: 0.01 },
        }),
      ),
      makeRunResult(
        input({
          run_id: "2",
          success: false,
          duration_ms: 3000,
          steps: 20,
          usage: { input_tokens: 2000, cached_input_tokens: 0, output_tokens: 200, cost_usd: 0.03 },
        }),
      ),
      makeRunResult(
        input({
          run_id: "3",
          arm: "D-oracle",
          success: true,
          duration_ms: 500,
          steps: 4,
          usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, cost_usd: 0.001 },
        }),
      ),
    ];

    const summary = summarizeByArm(results);
    const armB = summary.find((entry) => entry.arm === "B");
    if (!armB) throw new Error("expected arm B");

    expect(armB.runs).toBe(2);
    expect(armB.successRate).toBe(0.5);
    expect(armB.costPerCompleted).toBeCloseTo(0.04);
    expect(armB.costPerAttempt).toBeCloseTo(0.02);
    expect(armB.tokensPerStep).toBeCloseTo(110);
    expect(armB.stepsPerTask).toBeCloseTo(15);
    expect(armB.p50LatencyMs).toBe(2000);
  });

  it("renders a markdown table", () => {
    const results = [
      makeRunResult(input()),
      makeRunResult(input({ run_id: "run-2", success: false, duration_ms: 3000, steps: 20 })),
    ];
    const table = renderTable(results);
    expect(table).toContain("| Arm | Runs | Success |");
    expect(table).toContain("| B | 2 | 50.0% |");
  });

  it("writes the table to disk", () => {
    const file = join(tempDir(), "table.md");
    writeTable([makeRunResult(input())], file);
    expect(readFileSync(file, "utf8")).toContain("| B | 1 | 100.0% |");
  });

  it("regenerates the final table from raw results", () => {
    const file = join(tempDir(), "results.jsonl");
    appendResult(file, makeRunResult(input({ run_id: "1", template_id: "template-a" })));
    appendResult(
      file,
      makeRunResult(input({ run_id: "2", template_id: "template-a", success: false })),
    );
    appendResult(
      file,
      makeRunResult(input({ run_id: "3", template_id: "template-b", task_id: "template-b#1" })),
    );

    const results = readResults(file);
    const out = join(tempDir(), "final-table.md");
    writeFinalTable(results, out, { resamples: 100, seed: 1 });

    const table = readFileSync(out, "utf8");
    expect(table).toContain("| Arm | Runs | Templates | Success (95% CI)");
    expect(table).toContain("| B | 3 | 2 |");
  });

  it("rejects an invalid row", () => {
    const file = join(tempDir(), "results.jsonl");
    writeFileSync(file, '{"run_id":"bad"}\n', "utf8");
    expect(() => readResults(file)).toThrow(/invalid result/);
  });
});
