import { type ModelConfig, ModelPortError } from "./port.js";

/** Identity helper that keeps per-role model config typed at the call site. */
export function defineModelConfig(config: ModelConfig): ModelConfig {
  return config;
}

/**
 * A starting config for local development. It deliberately requires the
 * model ids: guessing a provider's current model id is how a build breaks
 * silently when a vendor retires one.
 */
export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const anthropicModel = env.ANTHROPIC_MODEL;
  const openaiModel = env.OPENAI_MODEL;

  if (!anthropicModel) {
    throw new ModelPortError("missing_model", "set ANTHROPIC_MODEL");
  }
  if (!openaiModel) {
    throw new ModelPortError("missing_model", "set OPENAI_MODEL");
  }

  return {
    segment: { provider: "anthropic", model: anthropicModel, maxTokens: 2048 },
    name: { provider: "openai", model: openaiModel, maxTokens: 1024 },
    repair: { provider: "anthropic", model: anthropicModel, maxTokens: 4096 },
    runner: { provider: "openai", model: openaiModel, maxTokens: 1024 },
  };
}
