import { describe, expect, it } from "vitest";

import {
  createAnthropicAdapter,
  createModelPort,
  createOpenAIAdapter,
  defineModelConfig,
  ModelPortError,
  modelConfigFromEnv,
  type ObjectRequest,
  type ObjectResult,
  type ProviderAdapter,
} from "./index.js";

const config = defineModelConfig({
  segment: { provider: "anthropic", model: "segment-model" },
  name: { provider: "openai", model: "name-model" },
  repair: { provider: "anthropic", model: "repair-model" },
  runner: { provider: "openai", model: "runner-model" },
});

function fakeAdapter(provider: string, model: string): ProviderAdapter {
  return {
    provider,
    model,
    async object<T>(_req: ObjectRequest): Promise<ObjectResult<T>> {
      return {
        value: { ok: true } as T,
        usage: { input: 10, cached_input: 2, output: 5, provider, model },
      };
    },
    async agent() {
      return {
        trace: "trace-1",
        usage: { input: 1, cached_input: 0, output: 1, provider, model },
      };
    },
  };
}

describe("createModelPort", () => {
  it("routes each role to its own adapter", async () => {
    const calls: string[] = [];
    const port = createModelPort(config, {
      adapterFactory: (roleConfig) => {
        calls.push(`${roleConfig.provider}:${roleConfig.model}`);
        return fakeAdapter(roleConfig.provider, roleConfig.model);
      },
    });

    const segment = await port.object<{ ok: boolean }>({
      role: "segment",
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });
    const name = await port.object<{ ok: boolean }>({
      role: "name",
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });

    expect(segment.usage.provider).toBe("anthropic");
    expect(segment.usage.model).toBe("segment-model");
    expect(name.usage.provider).toBe("openai");
    expect(name.usage.model).toBe("name-model");
    expect(calls).toEqual(["anthropic:segment-model", "openai:name-model"]);
  });

  it("reuses an adapter for repeated calls to the same role", async () => {
    let created = 0;
    const port = createModelPort(config, {
      adapterFactory: (roleConfig) => {
        created += 1;
        return fakeAdapter(roleConfig.provider, roleConfig.model);
      },
    });

    const req = {
      role: "segment" as const,
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    };
    await port.object(req);
    await port.object(req);

    expect(created).toBe(1);
  });

  it("reports normalized usage", async () => {
    const port = createModelPort(config, {
      adapterFactory: (roleConfig) => fakeAdapter(roleConfig.provider, roleConfig.model),
    });

    const { usage } = await port.object({
      role: "segment",
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });

    expect(usage).toEqual({
      input: 10,
      cached_input: 2,
      output: 5,
      provider: "anthropic",
      model: "segment-model",
    });
  });
});

describe("provider adapters", () => {
  it("refuses to build an anthropic adapter without a key", () => {
    expect(() => createAnthropicAdapter({ provider: "anthropic", model: "x", apiKey: "" })).toThrow(
      ModelPortError,
    );
  });

  it("refuses to build an openai adapter without a key", () => {
    expect(() => createOpenAIAdapter({ provider: "openai", model: "x", apiKey: "" })).toThrow(
      ModelPortError,
    );
  });
});

describe("modelConfigFromEnv", () => {
  it("fails loudly when a model id is missing", () => {
    expect(() => modelConfigFromEnv({})).toThrow(ModelPortError);
  });

  it("builds one config per role", () => {
    const fromEnv = modelConfigFromEnv({
      ANTHROPIC_MODEL: "claude-test",
      OPENAI_MODEL: "gpt-test",
    });

    expect(fromEnv.segment.provider).toBe("anthropic");
    expect(fromEnv.name.provider).toBe("openai");
    expect(fromEnv.repair.provider).toBe("anthropic");
    expect(fromEnv.runner.provider).toBe("openai");
  });
});
