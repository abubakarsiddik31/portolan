import { describe, expect, it } from "vitest";

import { createModelPort, defineModelConfig, type JSONSchema } from "./index.js";

const env = process.env;
const anthropicReady = Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL);
const openaiReady = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);

const schema: JSONSchema = {
  type: "object",
  properties: {
    city: { type: "string" },
    temperature_c: { type: "number" },
  },
  required: ["city", "temperature_c"],
  additionalProperties: false,
};

const system = "Return only the JSON object described by the schema.";
const prompt = "The weather in Paris is 21 degrees Celsius.";

describe.skipIf(!anthropicReady)("anthropic structured output", () => {
  it("returns a schema-valid object and billed usage", async () => {
    const port = createModelPort(
      defineModelConfig({
        segment: { provider: "anthropic", model: env.ANTHROPIC_MODEL as string },
        name: { provider: "anthropic", model: env.ANTHROPIC_MODEL as string },
        repair: { provider: "anthropic", model: env.ANTHROPIC_MODEL as string },
      }),
    );

    const { value, usage } = await port.object<{ city: string; temperature_c: number }>({
      role: "segment",
      system,
      prompt,
      schema,
      maxTokens: 200,
    });

    expect(value.city).toBeTypeOf("string");
    expect(value.temperature_c).toBeTypeOf("number");
    expect(usage.input).toBeGreaterThan(0);
    expect(usage.provider).toBe("anthropic");
  }, 60_000);
});

describe.skipIf(!openaiReady)("openai structured output", () => {
  it("returns a schema-valid object and billed usage", async () => {
    const port = createModelPort(
      defineModelConfig({
        segment: { provider: "openai", model: env.OPENAI_MODEL as string },
        name: { provider: "openai", model: env.OPENAI_MODEL as string },
        repair: { provider: "openai", model: env.OPENAI_MODEL as string },
      }),
    );

    const { value, usage } = await port.object<{ city: string; temperature_c: number }>({
      role: "segment",
      system,
      prompt,
      schema,
      maxTokens: 200,
    });

    expect(value.city).toBeTypeOf("string");
    expect(value.temperature_c).toBeTypeOf("number");
    expect(usage.input).toBeGreaterThan(0);
    expect(usage.provider).toBe("openai");
  }, 60_000);
});
