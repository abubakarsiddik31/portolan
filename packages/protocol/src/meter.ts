import { z } from "zod";

/**
 * Cost and latency for one call.
 *
 * Tokens are reported only when a model was involved (compiler and repair,
 * never the op hot path). `cost_usd` is billed cost, not a price-table
 * estimate; when a provider does not report it, the field is absent rather
 * than zero.
 */
export const meterSchema = z.object({
  ms: z.number().nonnegative(),
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
});

export type Meter = z.infer<typeof meterSchema>;
