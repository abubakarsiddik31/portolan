import { createOpenAI } from "@ai-sdk/openai";
import { generateText, jsonSchema, Output } from "ai";

import {
  type AgentRequest,
  type AgentResult,
  ModelPortError,
  type ObjectRequest,
  type ObjectResult,
  type OpenAIConfig,
  type ProviderAdapter,
  wrapProviderError,
} from "../port.js";
import { toUsage } from "../usage.js";

export function createOpenAIAdapter(config: OpenAIConfig): ProviderAdapter {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ModelPortError("missing_api_key", "set OPENAI_API_KEY or pass apiKey");
  }

  const provider = createOpenAI({
    apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  const model = provider(config.model);

  return {
    provider: "openai",
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
          usage: toUsage(result.usage, "openai", config.model),
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
