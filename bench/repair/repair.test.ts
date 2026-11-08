import { type RepairDecision, repairIntent } from "@portolan/compiler";
import {
  createModelPort,
  type ModelConfig,
  type ModelPort,
  type ObjectRequest,
  type Usage,
} from "@portolan/model";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const LOCAL_BASE = process.env.PORTOLAN_LOCAL_BASE_URL;
const LOCAL_MODEL = process.env.PORTOLAN_LOCAL_MODEL;
const LIVE = ENABLED && LOCAL_BASE !== undefined && LOCAL_MODEL !== undefined;

const USAGE: Usage = {
  input: 0,
  cached_input: 0,
  output: 0,
  provider: "scripted",
  model: "scripted",
};

type ScriptStep =
  | { kind: "act"; role: string; name: string; do: "click" | "fill"; value?: string }
  | { kind: "done"; answer: string };

/**
 * Resolve a role and name to the ref in the observation, the same way a model
 * reads the affordance list. The prompt has one line per affordance:
 * `e1a2b textbox "Search products"`.
 */
function refFromPrompt(prompt: string, role: string, name: string): string {
  const needle = `${role} ${JSON.stringify(name)}`;
  const line = prompt.split("\n").find((candidate) => candidate.includes(needle));
  const ref = line?.trim().split(" ")[0];

  if (ref === undefined || ref.length === 0) {
    throw new Error(`no ${role} named "${name}" in the observation`);
  }

  return ref;
}

function scriptedRepair(steps: ScriptStep[]): ModelPort {
  let index = 0;

  return {
    async object<T>(req: ObjectRequest): Promise<{ value: T; usage: Usage }> {
      const step = steps[index];
      index += 1;
      if (step === undefined) throw new Error("repair script ran out of steps");

      const decision: RepairDecision =
        step.kind === "done"
          ? { thought: "Done.", tool: "done", answer: step.answer }
          : {
              thought: `${step.do} ${step.role} "${step.name}".`,
              tool: "act",
              ref: refFromPrompt(req.prompt, step.role, step.name),
              do: step.do,
              ...(step.value !== undefined ? { value: step.value } : {}),
            };

      return { value: decision as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the repair script does not implement agent()");
    },
  };
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("headless repair", () => {
  let storeApp: FastifyInstance | undefined;
  let store = "";
  let engine: PlaywrightEngine | undefined;

  beforeAll(async () => {
    storeApp = await buildStoreApp();
    store = await listen(storeApp);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await storeApp?.close();
  });

  function current(): { engine: PlaywrightEngine; substrate: Substrate } {
    if (engine === undefined) throw new Error("the engine is not running");
    return { engine, substrate: new Substrate(engine) };
  }

  async function checkProduct(engine: PlaywrightEngine): Promise<boolean> {
    const url = await engine.evaluate<string>("location.href");
    const text = await engine.evaluate<string>("document.body.innerText");
    return /\/p\/p_\d+$/.test(new URL(url).pathname) && text.includes("Merino Socks");
  }

  it("completes an intent on the store with a scripted model", async () => {
    const { engine, substrate } = current();
    await engine.navigate(store);

    const result = await repairIntent({
      model: scriptedRepair([
        {
          kind: "act",
          role: "textbox",
          name: "Search products",
          do: "fill",
          value: "socks",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: "Merino Socks", do: "click" },
        { kind: "done", answer: "Opened the Merino Socks page." },
      ]),
      substrate,
      goal: "Search the catalog for socks and open the Merino Socks product page.",
      effect: "read",
      maxSteps: 10,
      check: () => checkProduct(engine),
    });

    expect(result.ok).toBe(true);
    expect(result.trace.entries.map((entry) => entry.kind)).toEqual(["view", "act", "act", "act"]);
  }, 120_000);

  it.skipIf(!LIVE)(
    "completes an intent with a local open-weights model",
    async () => {
      if (LOCAL_BASE === undefined || LOCAL_MODEL === undefined) {
        throw new Error("the local model environment is missing");
      }

      const config: ModelConfig = {
        segment: localConfig(LOCAL_BASE, LOCAL_MODEL),
        name: localConfig(LOCAL_BASE, LOCAL_MODEL),
        repair: localConfig(LOCAL_BASE, LOCAL_MODEL),
        runner: localConfig(LOCAL_BASE, LOCAL_MODEL),
      };

      const { engine, substrate } = current();
      await engine.navigate(store);

      const result = await repairIntent({
        model: createModelPort(config),
        substrate,
        goal: "Search the catalog for socks and open the Merino Socks product page.",
        effect: "read",
        maxSteps: 12,
        check: () => checkProduct(engine),
      });

      expect(result.ok).toBe(true);
    },
    180_000,
  );
});

function localConfig(baseURL: string, model: string) {
  return {
    provider: "openai-compatible" as const,
    model,
    baseURL,
    ...(process.env.PORTOLAN_LOCAL_API_KEY !== undefined
      ? { apiKey: process.env.PORTOLAN_LOCAL_API_KEY }
      : {}),
  };
}
