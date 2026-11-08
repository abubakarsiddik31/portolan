import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, Output } from "ai";

import {
  type AgentRequest,
  type AgentResult,
  type AnthropicConfig,
  ModelPortError,
  type ObjectRequest,
  type ObjectResult,
  type ProviderAdapter,
  wrapProviderError,
} from "../port.js";
import { toUsage } from "../usage.js";

export function createAnthropicAdapter(config: AnthropicConfig): ProviderAdapter {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ModelPortError("missing_api_key", "set ANTHROPIC_API_KEY or pass apiKey");
  }

  const provider = createAnthropic({
    apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  const model = provider(config.model);

  return {
    provider: "anthropic",
    model: config.model,
    async object<T>(req: ObjectRequest): Promise<ObjectResult<T>> {
      try {
        const maxOutputTokens = req.maxTokens ?? config.maxTokens;
        const result = await generateText({
          model,
          system: req.system,
          prompt: req.prompt,
          output: Output.object({ schema: jsonSchema<Record<string, unknown>>(req.schema) }),
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        });
        return {
          value: result.output as T,
          usage: toUsage(result.usage, "anthropic", config.model),
        };
      } catch (error) {
        throw wrapProviderError(error);
      }
    },
    async agent(_req: AgentRequest): Promise<AgentResult> {
      throw new ModelPortError(
        "agent_not_implemented",
        "agent() lands with headless repair (T3.06)",
      );
    },
  };
}
