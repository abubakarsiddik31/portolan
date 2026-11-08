import { existsSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { loadTasks } from "../tasks/load.js";
import { AgentBrowserBackend } from "./agent-browser-backend.js";
import { runTask } from "./runner.js";
import { createScriptedModel } from "./scripted-model.js";
import { TaskSuccessChecker } from "./task-checker.js";
import type { Decision } from "./types.js";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);
const hasAgentBrowser =
  Boolean(process.env.AGENT_BROWSER_BIN) ||
  existsSync(`${process.cwd()}/bench/node_modules/.bin/agent-browser`);

let storeApp: FastifyInstance;

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
    thought: "Open the tee.",
    tool: "find",
    arguments: { locator: "text", value: "Everyday Tee", action: "click" },
    answer: "",
  },
  { thought: "Let the product page load.", tool: "wait", arguments: { ms: 500 }, answer: "" },
  {
    thought: "Choose M / Blue.",
    tool: "select",
    arguments: { target: "#variant", value: "v_101_m_blue" },
    answer: "",
  },
  { thought: "One unit.", tool: "fill", arguments: { target: "#qty", text: "1" }, answer: "" },
  {
    thought: "Add it.",
    tool: "find",
    arguments: { locator: "role", value: "button", action: "click", name: "Add to cart" },
    answer: "",
  },
  { thought: "Let the cart load.", tool: "wait", arguments: { ms: 800 }, answer: "" },
  {
    thought: "Go to checkout.",
    tool: "find",
    arguments: { locator: "role", value: "link", action: "click", name: "Checkout" },
    answer: "",
  },
  { thought: "Let checkout load.", tool: "wait", arguments: { ms: 500 }, answer: "" },
  {
    thought: "Name.",
    tool: "fill",
    arguments: { target: "#name", text: "Ada Lovelace" },
    answer: "",
  },
  {
    thought: "Email.",
    tool: "fill",
    arguments: { target: "#email", text: "ada@example.com" },
    answer: "",
  },
  {
    thought: "Address.",
    tool: "fill",
    arguments: { target: "#address", text: "1 Analytical Way" },
    answer: "",
  },
  { thought: "City.", tool: "fill", arguments: { target: "#city", text: "London" }, answer: "" },
  {
    thought: "Postal code.",
    tool: "fill",
    arguments: { target: "#postal", text: "N1 1AA" },
    answer: "",
  },
  {
    thought: "Card.",
    tool: "fill",
    arguments: { target: "#card", text: "4242424242424242" },
    answer: "",
  },
  {
    thought: "Place the order.",
    tool: "find",
    arguments: { locator: "role", value: "button", action: "click", name: "Place order" },
    answer: "",
  },
  {
    thought: "Wait for the confirmation.",
    tool: "wait",
    arguments: { ms: 1200 },
    answer: "",
  },
  { thought: "Done.", tool: "", arguments: {}, answer: "Order placed." },
];

beforeAll(async () => {
  storeApp = await buildStoreApp();
  await storeApp.listen({ port: 0, host: "127.0.0.1" });
}, 30_000);

afterAll(async () => {
  await storeApp?.close();
});

describe.skipIf(!hasChrome || !hasAgentBrowser)("agent-browser runner", () => {
  it("completes the store purchase through the shared runner", async () => {
    const storeURL = `http://127.0.0.1:${portOf(storeApp)}`;
    const backend = new AgentBrowserBackend({
      baseURLs: { store: storeURL, wizard: storeURL, portal: storeURL },
    });

    try {
      const outcome = await runTask({
        task: buyTask,
        arm: "B",
        model: createScriptedModel(buyScript),
        backend,
        provider: "agent-browser",
        modelId: "scripted",
        maxSteps: 20,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.arm).toBe("B");
      expect(outcome.result.steps).toBeGreaterThanOrEqual(12);
    } finally {
      await backend.close();
    }
  }, 120_000);
});
