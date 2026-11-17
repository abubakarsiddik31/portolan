import { randomUUID } from "node:crypto";

import type { Usage } from "@abubakarsiddiik/model";

import { makeRunResult, type RunResult } from "../results/schema.js";
import { type Decision, decisionJsonSchema } from "./decision.js";
import { buildObservation, RUNNER_SYSTEM } from "./prompt.js";
import type { RunnerOptions, RunOutcome, StepRecord } from "./types.js";

const DEFAULT_MAX_STEPS = 25;
const MAX_TRANSCRIPT_CHARS = 4_000;

function truncate(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

function sumUsage(usages: Usage[]): { input: number; cached_input: number; output: number } {
  return usages.reduce(
    (sum, usage) => ({
      input: sum.input + usage.input,
      cached_input: sum.cached_input + usage.cached_input,
      output: sum.output + usage.output,
    }),
    { input: 0, cached_input: 0, output: 0 },
  );
}

function costOf(
  tokens: { input: number; output: number },
  price?: { inputPer1m: number; outputPer1m: number },
): number {
  if (!price) return 0;
  return (
    (tokens.input / 1_000_000) * price.inputPer1m + (tokens.output / 1_000_000) * price.outputPer1m
  );
}

export async function runTask(options: RunnerOptions): Promise<RunOutcome> {
  const started = Date.now();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const history = options.history ?? "compact";
  const steps: StepRecord[] = [];
  const usages: Usage[] = [];
  const transcript: string[] = [];

  let success = false;
  let detail: string | undefined;

  const tools = await options.backend.listTools();

  if (options.backend.openSite) {
    const opened = await options.backend.openSite(options.task.site);
    transcript.push(`OPEN SITE ${options.task.site}:\n${truncate(opened.text)}`);
    if (!opened.ok) detail = opened.text;
  }

  for (let step = 1; step <= maxSteps && detail === undefined; step += 1) {
    const observation = buildObservation({
      task: options.task,
      step,
      maxSteps,
      tools,
      transcript,
      history,
    });

    const decisionStarted = Date.now();
    const decided = await options.model.object<Decision>({
      role: "runner",
      system: RUNNER_SYSTEM,
      prompt: observation,
      schema: decisionJsonSchema,
      maxTokens: 800,
    });
    usages.push(decided.usage);

    const decision = decided.value;
    if (!decision.tool) {
      success = true;
      transcript.push(`ANSWER: ${decision.answer}`);
      break;
    }

    const result = await options.backend.callTool(decision.tool, decision.arguments);
    const record: StepRecord = {
      step,
      decision,
      result,
      usage: decided.usage,
      ms: Date.now() - decisionStarted,
    };
    steps.push(record);
    options.onStep?.(record);

    transcript.push(
      `STEP ${step}: ${decision.tool}(${JSON.stringify(decision.arguments)})\nRESULT: ${truncate(
        result.text,
      )}`,
    );
    if (!result.ok) detail = result.text;
  }

  if (success && options.checker) {
    const checked = await options.checker.check(options.task, steps);
    success = checked.success;
    if (!checked.success) detail = checked.detail ?? "success predicate failed";
  }

  if (!success && detail === undefined) detail = "max steps reached";

  const tokens = sumUsage(usages);
  const result: RunResult = makeRunResult({
    run_id: randomUUID(),
    task_id: options.task.id,
    template_id: options.task.template_id,
    site: options.task.site,
    arm: options.arm,
    provider: options.provider,
    model: options.modelId,
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    steps: steps.length,
    success,
    ...(detail === undefined ? {} : { failure_reason: detail }),
    usage: {
      input_tokens: tokens.input,
      cached_input_tokens: tokens.cached_input,
      output_tokens: tokens.output,
      cost_usd: costOf(tokens, options.price),
    },
  });

  return {
    result,
    steps,
    success,
    ...(detail === undefined ? {} : { detail }),
  };
}
