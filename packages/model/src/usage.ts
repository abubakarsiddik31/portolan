import type { LanguageModelUsage } from "ai";

import type { Usage } from "./port.js";

export function toUsage(usage: LanguageModelUsage, provider: string, model: string): Usage {
  return {
    input: usage.inputTokens ?? 0,
    cached_input: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    output: usage.outputTokens ?? 0,
    provider,
    model,
  };
}
