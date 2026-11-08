import { createAdapter } from "./adapters/index.js";
import type {
  AgentRequest,
  AgentResult,
  ModelConfig,
  ModelPort,
  ModelRole,
  ObjectRequest,
  ObjectResult,
  ProviderAdapter,
  ProviderConfig,
} from "./port.js";

export type ModelPortOptions = {
  /** Inject a fake in tests, or a custom adapter in a host application. */
  adapterFactory?: (config: ProviderConfig) => ProviderAdapter;
};

/**
 * Build the port lazily: a role with a missing key or a bad model id only
 * fails when that role is actually used, not when the process starts.
 */
export function createModelPort(config: ModelConfig, options: ModelPortOptions = {}): ModelPort {
  const factory = options.adapterFactory ?? createAdapter;
  const adapters = new Map<ModelRole, ProviderAdapter>();

  const adapterFor = (role: ModelRole): ProviderAdapter => {
    const cached = adapters.get(role);
    if (cached) return cached;
    const adapter = factory(config[role]);
    adapters.set(role, adapter);
    return adapter;
  };

  return {
    object<T>(req: ObjectRequest): Promise<ObjectResult<T>> {
      return adapterFor(req.role).object<T>(req);
    },
    agent(req: AgentRequest): Promise<AgentResult> {
      return adapterFor(req.role).agent(req);
    },
  };
}
