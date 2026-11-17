import { createModelPort, type ModelConfig, type ProviderConfig } from "@abubakarsiddiik/model";
import { findChrome } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { runTask } from "../runner/runner.js";
import { SubstrateBackend } from "../runner/substrate-backend.js";
import { TaskSuccessChecker } from "../runner/task-checker.js";
import { loadTasks } from "../tasks/load.js";

const CHROME = findChrome();
const BASE = process.env.PORTOLAN_LOCAL_BASE_URL;
const MODEL = process.env.PORTOLAN_LOCAL_MODEL;
const ENABLED =
  CHROME !== undefined &&
  BASE !== undefined &&
  MODEL !== undefined &&
  (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function local(baseURL: string, model: string): ProviderConfig {
  return {
    provider: "openai-compatible",
    model,
    baseURL,
    ...(process.env.PORTOLAN_LOCAL_API_KEY !== undefined
      ? { apiKey: process.env.PORTOLAN_LOCAL_API_KEY }
      : {}),
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

describe.skipIf(!ENABLED)("open-weights smoke", () => {
  let storeApp: FastifyInstance | undefined;
  let store = "";

  beforeAll(async () => {
    storeApp = await buildStoreApp();
    store = await listen(storeApp);
  }, 30_000);

  afterAll(async () => {
    await storeApp?.close();
  });

  it("completes one template on a local OpenAI-compatible model", async () => {
    if (BASE === undefined || MODEL === undefined || CHROME === undefined) {
      throw new Error("the local model environment is missing");
    }

    const task = loadTasks().find((candidate) => candidate.id === "store-search-read#1");
    if (task === undefined) throw new Error("store-search-read#1 is missing");

    const config: ModelConfig = {
      segment: local(BASE, MODEL),
      name: local(BASE, MODEL),
      repair: local(BASE, MODEL),
      runner: local(BASE, MODEL),
    };

    const backend = new SubstrateBackend({
      baseURLs: { store, wizard: store, portal: store },
      executablePath: CHROME,
    });

    try {
      const outcome = await runTask({
        task,
        arm: "C",
        model: createModelPort(config),
        backend,
        provider: "openai-compatible",
        modelId: MODEL,
        maxSteps: 12,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success, outcome.detail ?? "the local model did not finish").toBe(true);
    } finally {
      await backend.close();
    }
  }, 300_000);
});
