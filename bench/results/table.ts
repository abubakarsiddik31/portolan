import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { RunResult } from "./schema.js";

export type ArmSummary = {
  arm: string;
  runs: number;
  successes: number;
  successRate: number;
  costPerCompleted: number;
  costPerAttempt: number;
  tokensPerStep: number;
  stepsPerTask: number;
  p50LatencyMs: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lower = sorted[middle - 1] ?? 0;
    const upper = sorted[middle] ?? 0;
    return (lower + upper) / 2;
  }
  return sorted[middle] ?? 0;
}

export function summarizeByArm(results: RunResult[]): ArmSummary[] {
  const arms = [...new Set(results.map((result) => result.arm))].sort();

  return arms.map((arm) => {
    const runs = results.filter((result) => result.arm === arm);
    const successes = runs.filter((result) => result.success).length;
    const totalCost = runs.reduce((sum, result) => sum + result.total_cost_usd, 0);
    const totalTokens = runs.reduce(
      (sum, result) => sum + result.usage.input_tokens + result.usage.output_tokens,
      0,
    );
    const totalSteps = runs.reduce((sum, result) => sum + result.steps, 0);

    return {
      arm,
      runs: runs.length,
      successes,
      successRate: runs.length > 0 ? successes / runs.length : 0,
      costPerCompleted: successes > 0 ? totalCost / successes : 0,
      costPerAttempt: runs.length > 0 ? totalCost / runs.length : 0,
      tokensPerStep: totalSteps > 0 ? totalTokens / totalSteps : 0,
      stepsPerTask: runs.length > 0 ? totalSteps / runs.length : 0,
      p50LatencyMs: median(runs.map((result) => result.duration_ms)),
    };
  });
}

export function renderTable(results: RunResult[]): string {
  const header =
    "| Arm | Runs | Success | $/completed | $/attempt | Tokens/step | Steps/task | p50 latency |";
  const divider = "|---|---:|---:|---:|---:|---:|---:|---:|";
  const body = summarizeByArm(results).map(
    (summary) =>
      `| ${summary.arm} | ${summary.runs} | ${(summary.successRate * 100).toFixed(1)}% | $${summary.costPerCompleted.toFixed(4)} | $${summary.costPerAttempt.toFixed(4)} | ${summary.tokensPerStep.toFixed(0)} | ${summary.stepsPerTask.toFixed(1)} | ${summary.p50LatencyMs.toFixed(0)} ms |`,
  );

  return [header, divider, ...body].join("\n");
}

export function writeTable(results: RunResult[], file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${renderTable(results)}\n`, "utf8");
}
