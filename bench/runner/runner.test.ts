import { existsSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildOracleServer } from "../oracle/server.js";
import { loadTasks } from "../tasks/load.js";
import { McpBackend } from "./backend.js";
import { OracleSuccessChecker } from "./oracle-checker.js";
import { runTask } from "./runner.js";
import { createScriptedModel } from "./scripted-model.js";
import type { Decision } from "./types.js";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);

let storeApp: FastifyInstance;
let closeOracle: (() => Promise<void>) | undefined;

function portOf(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  return address.port;
}

const buyTask = (() => {
  const task = loadTasks().find((candidate) => candidate.id === "store-buy-variant#1");
  if (!task) throw new Error("store-buy-variant#1 is missing");
  return task;
})();

const buyScript: Decision[] = [
  {
    thought: "Search for the tee.",
    tool: "call",
    arguments: { op: "search", params: { query: "tee" } },
    answer: "",
  },
  {
    thought: "Read the product.",
    tool: "call",
    arguments: { op: "get_product", params: { product_id: "p_101" } },
    answer: "",
  },
  {
    thought: "Add it to the cart.",
    tool: "call",
    arguments: {
      op: "add_to_cart",
      params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
    },
    answer: "",
  },
  {
    thought: "Check out.",
    tool: "call",
    arguments: {
      op: "checkout",
      params: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        address: "1 Analytical Way",
        city: "London",
        postal: "N1 1AA",
        card: "4242424242424242",
      },
    },
    answer: "",
  },
  { thought: "Done.", tool: "", arguments: {}, answer: "Order placed." },
];

const earlyStopScript: Decision[] = [
  {
    thought: "Search only.",
    tool: "call",
    arguments: { op: "search", params: { query: "tee" } },
    answer: "",
  },
  { thought: "Done.", tool: "", arguments: {}, answer: "I found the tee." },
];

beforeAll(async () => {
  storeApp = await buildStoreApp();
  await storeApp.listen({ port: 0, host: "127.0.0.1" });
}, 30_000);

afterAll(async () => {
  await closeOracle?.();
  await storeApp?.close();
});

describe.skipIf(!hasChrome)("common runner", () => {
  it("drives the oracle through a scripted task and verifies the predicate", async () => {
    const storeURL = `http://127.0.0.1:${portOf(storeApp)}`;
    const oracle = await buildOracleServer({
      baseURLs: { store: storeURL, wizard: storeURL, portal: storeURL },
      chromePath,
    });
    closeOracle = oracle.close;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await oracle.server.connect(serverTransport);
    const client = new Client({ name: "runner-test", version: "0.0.1" });
    await client.connect(clientTransport);
    const backend = new McpBackend(client);

    const outcome = await runTask({
      task: buyTask,
      arm: "D-oracle",
      model: createScriptedModel(buyScript),
      backend,
      provider: "scripted",
      modelId: "scripted",
      maxSteps: 10,
      checker: new OracleSuccessChecker(backend),
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.steps).toBe(4);
    expect(outcome.steps).toHaveLength(4);
    expect(outcome.result.task_id).toBe("store-buy-variant#1");
    expect(outcome.result.arm).toBe("D-oracle");
    expect(outcome.result.usage.cost_usd).toBe(0);

    await client.close();
    await oracle.server.close();
  }, 60_000);

  it("fails the task when the model stops before the predicate holds", async () => {
    const storeURL = `http://127.0.0.1:${portOf(storeApp)}`;
    const oracle = await buildOracleServer({
      baseURLs: { store: storeURL, wizard: storeURL, portal: storeURL },
      chromePath,
    });
    closeOracle = oracle.close;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await oracle.server.connect(serverTransport);
    const client = new Client({ name: "runner-test-fail", version: "0.0.1" });
    await client.connect(clientTransport);
    const backend = new McpBackend(client);

    const outcome = await runTask({
      task: buyTask,
      arm: "D-oracle",
      model: createScriptedModel(earlyStopScript),
      backend,
      provider: "scripted",
      modelId: "scripted",
      maxSteps: 10,
      checker: new OracleSuccessChecker(backend),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.detail).toContain("did not match");

    await client.close();
    await oracle.server.close();
  }, 60_000);
});
