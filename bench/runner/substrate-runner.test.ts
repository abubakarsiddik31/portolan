import { findChrome } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { loadTasks } from "../tasks/load.js";
import { runTask } from "./runner.js";
import { SubstrateBackend } from "./substrate-backend.js";
import { createSubstrateModel, type SubstrateStep } from "./substrate-model.js";
import { TaskSuccessChecker } from "./task-checker.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function task(id: string) {
  const found = loadTasks().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`${id} is missing`);
  return found;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

const storeSteps: SubstrateStep[] = [
  { kind: "view" },
  { kind: "act", role: "textbox", name: "Search products", do: "fill", value: "tee" },
  { kind: "act", role: "button", name: "Search", do: "click" },
  { kind: "view" },
  { kind: "act", role: "link", name: "Everyday Tee", do: "click" },
  { kind: "view" },
  { kind: "act", role: "combobox", name: "Size / color", do: "select", value: "v_101_m_blue" },
  { kind: "act", role: "spinbutton", name: "Quantity", do: "fill", value: "1" },
  { kind: "act", role: "button", name: "Add to cart", do: "click" },
  { kind: "view" },
  { kind: "act", role: "link", name: "Checkout", do: "click" },
  { kind: "view" },
  { kind: "act", role: "textbox", name: "Full name", do: "fill", value: "Ada Lovelace" },
  { kind: "act", role: "textbox", name: "Email", do: "fill", value: "ada@example.com" },
  { kind: "act", role: "textbox", name: "Address", do: "fill", value: "1 Analytical Way" },
  { kind: "act", role: "textbox", name: "City", do: "fill", value: "London" },
  { kind: "act", role: "textbox", name: "Postal code", do: "fill", value: "N1 1AA" },
  { kind: "act", role: "textbox", name: "Card number", do: "fill", value: "4242424242424242" },
  { kind: "act", role: "button", name: "Place order", do: "click" },
  { kind: "done", answer: "Order placed." },
];

const searchSteps: SubstrateStep[] = [
  { kind: "view" },
  { kind: "act", role: "textbox", name: "Search products", do: "fill", value: "socks" },
  { kind: "act", role: "button", name: "Search", do: "click" },
  { kind: "view" },
  { kind: "act", role: "link", name: "Merino Socks", do: "click" },
  { kind: "done", answer: "Opened the Merino Socks product page." },
];

const portalSteps: SubstrateStep[] = [
  { kind: "view" },
  { kind: "act", role: "textbox", name: "Email", do: "fill", value: "analyst@example.com" },
  { kind: "act", role: "textbox", name: "Password", do: "fill", value: "portolan" },
  { kind: "act", role: "button", name: "Sign in", do: "click" },
  { kind: "view" },
  { kind: "act", role: "combobox", name: "Status", do: "select", value: "paid" },
  { kind: "act", role: "button", name: "Filter", do: "click" },
  { kind: "done", answer: "Filtered to paid invoices." },
];

const paginateSteps: SubstrateStep[] = [
  { kind: "view" },
  { kind: "act", role: "textbox", name: "Email", do: "fill", value: "analyst@example.com" },
  { kind: "act", role: "textbox", name: "Password", do: "fill", value: "portolan" },
  { kind: "act", role: "button", name: "Sign in", do: "click" },
  { kind: "view" },
  { kind: "act", role: "link", name: "Next", do: "click" },
  { kind: "done", answer: "Opened page 2." },
];

describe.skipIf(!ENABLED)("arm C substrate backend", () => {
  let storeApp: FastifyInstance | undefined;
  let portalApp: FastifyInstance | undefined;
  let baseURLs: { store: string; wizard: string; portal: string };

  beforeAll(async () => {
    storeApp = await buildStoreApp();
    portalApp = await buildPortalApp();
    const store = await listen(storeApp);
    const portal = await listen(portalApp);
    baseURLs = { store, wizard: store, portal };
  }, 30_000);

  afterAll(async () => {
    await storeApp?.close();
    await portalApp?.close();
  });

  it("completes the store purchase with view, act, and read only", async () => {
    const backend = new SubstrateBackend({ baseURLs, executablePath: CHROME });

    try {
      const outcome = await runTask({
        task: task("store-buy-variant#1"),
        arm: "C",
        model: createSubstrateModel(storeSteps, (role, name) => backend.resolveRef(role, name)),
        backend,
        provider: "scripted",
        modelId: "scripted",
        maxSteps: 25,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.arm).toBe("C");
      expect(outcome.result.steps).toBe(storeSteps.length - 1);
    } finally {
      await backend.close();
    }
  }, 120_000);

  it("searches the catalog and opens a product", async () => {
    const backend = new SubstrateBackend({ baseURLs, executablePath: CHROME });

    try {
      const outcome = await runTask({
        task: task("store-search-read#1"),
        arm: "C",
        model: createSubstrateModel(searchSteps, (role, name) => backend.resolveRef(role, name)),
        backend,
        provider: "scripted",
        modelId: "scripted",
        maxSteps: 15,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.arm).toBe("C");
    } finally {
      await backend.close();
    }
  }, 120_000);

  it("filters the portal ledger after signing in", async () => {
    const backend = new SubstrateBackend({ baseURLs, executablePath: CHROME });

    try {
      const outcome = await runTask({
        task: task("portal-filter-status#1"),
        arm: "C",
        model: createSubstrateModel(portalSteps, (role, name) => backend.resolveRef(role, name)),
        backend,
        provider: "scripted",
        modelId: "scripted",
        maxSteps: 15,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.arm).toBe("C");
      expect(outcome.result.steps).toBe(portalSteps.length - 1);
    } finally {
      await backend.close();
    }
  }, 120_000);

  it("paginates the portal ledger", async () => {
    const backend = new SubstrateBackend({ baseURLs, executablePath: CHROME });

    try {
      const outcome = await runTask({
        task: task("portal-paginate#1"),
        arm: "C",
        model: createSubstrateModel(paginateSteps, (role, name) => backend.resolveRef(role, name)),
        backend,
        provider: "scripted",
        modelId: "scripted",
        maxSteps: 15,
        checker: new TaskSuccessChecker(backend),
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.arm).toBe("C");
    } finally {
      await backend.close();
    }
  }, 120_000);
});
