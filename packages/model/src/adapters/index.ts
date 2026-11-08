import type { ProviderAdapter, ProviderConfig } from "../port.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createOpenAIAdapter } from "./openai.js";
import { createOpenAICompatibleAdapter } from "./openai-compatible.js";

export { createAnthropicAdapter, createOpenAIAdapter, createOpenAICompatibleAdapter };

export function createAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAdapter(config);
    case "openai":
      return createOpenAIAdapter(config);
    case "openai-compatible":
      return createOpenAICompatibleAdapter(config);
    default: {
      const exhaustive: never = config;
      return exhaustive;
    }
  }
}
