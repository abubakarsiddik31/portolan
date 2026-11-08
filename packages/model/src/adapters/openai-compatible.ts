import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, Output } from "ai";

import {
  type AgentRequest,
  type AgentResult,
  ModelPortError,
  type ObjectRequest,
  type ObjectResult,
  type OpenAICompatibleConfig,
  type ProviderAdapter,
  wrapProviderError,
} from "../port.js";
import { toUsage } from "../usage.js";

/**
 * Local servers (Ollama, vLLM, LM Studio) usually ignore the bearer token,
 * but the OpenAI-compatible client still expects one.
 */
export function createOpenAICompatibleAdapter(config: OpenAICompatibleConfig): ProviderAdapter {
  const apiKey = config.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? "local";
  const name = config.name ?? "openai-compatible";

  const provider = createOpenAICompatible({
    name,
    baseURL: config.baseURL,
    apiKey,
  });
  const model = provider(config.model);

  return {
    provider: name,
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
          usage: toUsage(result.usage, name, config.model),
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
