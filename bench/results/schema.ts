import { z } from "zod";

export const armSchema = z.enum(["A", "B", "C", "D-oracle", "D"]);
export const siteSchema = z.enum(["store", "wizard", "portal", "library", "support"]);

export const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
});

export const runResultSchema = z.object({
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  template_id: z.string().min(1),
  site: siteSchema,
  arm: armSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  started_at: z.string().min(1),
  duration_ms: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  success: z.boolean(),
  failure_reason: z.string().optional(),
  usage: usageSchema,
  browser_cost_usd: z.number().nonnegative(),
  total_cost_usd: z.number().nonnegative(),
  latency_ms_p50: z.number().nonnegative().optional(),
  tier_mix: z.record(z.string(), z.number().int().nonnegative()).optional(),
  artifacts: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type Arm = z.infer<typeof armSchema>;
export type RunResult = z.infer<typeof runResultSchema>;

export type RunInput = Omit<RunResult, "browser_cost_usd" | "total_cost_usd"> & {
  browser_cost_usd?: number;
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function makeRunResult(input: RunInput): RunResult {
  const browserCost = input.browser_cost_usd ?? 0;
  return {
    ...input,
    browser_cost_usd: browserCost,
    total_cost_usd: round6(input.usage.cost_usd + browserCost),
  };
}
