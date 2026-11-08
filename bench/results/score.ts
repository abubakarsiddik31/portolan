import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { RunResult } from "./schema.js";

export type Interval = {
  estimate: number;
  lower: number;
  upper: number;
  resamples: number;
};

export type TemplateScore = {
  templateId: string;
  runs: number;
  successes: number;
  successRate: number;
  costPerCompleted?: number;
  stepsPerTask: number;
};

export type ScoredArm = {
  arm: string;
  runs: number;
  templates: TemplateScore[];
  successRate: Interval;
  costPerCompleted?: Interval;
  stepsPerTask: Interval;
};

export type ScoreOptions = {
  resamples?: number;
  confidence?: number;
  seed?: number;
};

const DEFAULT_RESAMPLES = 2_000;
const DEFAULT_CONFIDENCE = 0.95;
const DEFAULT_SEED = 42;

/**
 * Score by template, then bootstrap over templates.
 *
 * Runs of the same template are correlated, so resampling runs would pretend
 * there is more evidence than there is. The unit of evidence is the template.
 */
export function scoreByArm(results: RunResult[], options: ScoreOptions = {}): ScoredArm[] {
  const arms = [...new Set(results.map((result) => result.arm))].sort();

  return arms.map((arm) => {
    const armRuns = results.filter((result) => result.arm === arm);
    const byTemplate = new Map<string, RunResult[]>();

    for (const run of armRuns) {
      const list = byTemplate.get(run.template_id) ?? [];
      list.push(run);
      byTemplate.set(run.template_id, list);
    }

    const templates: TemplateScore[] = [...byTemplate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([templateId, runs]) => {
        const successes = runs.filter((run) => run.success).length;
        const totalCost = runs.reduce((sum, run) => sum + run.total_cost_usd, 0);
        const totalSteps = runs.reduce((sum, run) => sum + run.steps, 0);

        return {
          templateId,
          runs: runs.length,
          successes,
          successRate: runs.length > 0 ? successes / runs.length : 0,
          ...(successes > 0 ? { costPerCompleted: totalCost / successes } : {}),
          stepsPerTask: runs.length > 0 ? totalSteps / runs.length : 0,
        };
      });

    const costValues = templates
      .map((template) => template.costPerCompleted)
      .filter((value): value is number => value !== undefined);

    return {
      arm,
      runs: armRuns.length,
      templates,
      successRate: bootstrapInterval(
        templates.map((template) => template.successRate),
        options,
      ),
      ...(costValues.length > 0
        ? { costPerCompleted: bootstrapInterval(costValues, options) }
        : {}),
      stepsPerTask: bootstrapInterval(
        templates.map((template) => template.stepsPerTask),
        options,
      ),
    };
  });
}

/** Percentile bootstrap over a list of per-template values. */
export function bootstrapInterval(values: number[], options: ScoreOptions = {}): Interval {
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  const random = mulberry32(options.seed ?? DEFAULT_SEED);

  if (values.length === 0) {
    return { estimate: 0, lower: 0, upper: 0, resamples };
  }

  const estimate = mean(values);

  if (values.length === 1) {
    return { estimate, lower: estimate, upper: estimate, resamples };
  }

  const samples: number[] = [];

  for (let index = 0; index < resamples; index += 1) {
    let sum = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      const picked = values[Math.floor(random() * values.length)];
      sum += picked ?? 0;
    }
    samples.push(sum / values.length);
  }

  samples.sort((a, b) => a - b);
  const lowerIndex = Math.floor(((1 - confidence) / 2) * (samples.length - 1));
  const upperIndex = Math.ceil(((1 + confidence) / 2) * (samples.length - 1));

  return {
    estimate,
    lower: samples[lowerIndex] ?? estimate,
    upper: samples[upperIndex] ?? estimate,
    resamples,
  };
}

export function renderFinalTable(results: RunResult[], options: ScoreOptions = {}): string {
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  const label = `${(confidence * 100).toFixed(0)}% CI`;
  const header = `| Arm | Runs | Templates | Success (${label}) | $/completed (${label}) | Steps/task (${label}) |`;
  const divider = "|---|---:|---:|---|---|---|";

  const body = scoreByArm(results, options).map(
    (arm) =>
      `| ${arm.arm} | ${arm.runs} | ${arm.templates.length} | ${percent(arm.successRate)} | ${
        arm.costPerCompleted === undefined ? "—" : money(arm.costPerCompleted)
      } | ${metric(arm.stepsPerTask)} |`,
  );

  return [header, divider, ...body].join("\n");
}

export function writeFinalTable(
  results: RunResult[],
  file: string,
  options: ScoreOptions = {},
): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${renderFinalTable(results, options)}\n`, "utf8");
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(interval: Interval): string {
  return `${(interval.estimate * 100).toFixed(1)}% (${(interval.lower * 100).toFixed(
    1,
  )}–${(interval.upper * 100).toFixed(1)})`;
}

function money(interval: Interval): string {
  return `$${interval.estimate.toFixed(4)} ($${interval.lower.toFixed(
    4,
  )}–$${interval.upper.toFixed(4)})`;
}

function metric(interval: Interval): string {
  return `${interval.estimate.toFixed(1)} (${interval.lower.toFixed(
    1,
  )}–${interval.upper.toFixed(1)})`;
}

function mulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
