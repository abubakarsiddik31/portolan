import { z } from "zod";

export const decisionSchema = z.object({
  thought: z.string(),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  answer: z.string(),
});

export type Decision = z.infer<typeof decisionSchema>;

/**
 * The runner uses structured output rather than provider-native tool calling.
 * It keeps the loop identical across providers and works with models that do
 * not implement tool calls.
 */
export const decisionJsonSchema = z.toJSONSchema(decisionSchema) as Record<string, unknown>;
