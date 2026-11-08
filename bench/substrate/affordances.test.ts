import type { Affordance, Snapshot } from "@portolan/substrate";
import {
  buildRefMap,
  findChrome,
  PlaywrightEngine,
  rankAffordances,
  renderAffordances,
} from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildWizardApp } from "../fixtures/wizard/v1/app.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function chromePath(): string {
  if (CHROME === undefined) throw new Error("Chrome is required");
  return CHROME;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

type Capture = {
  snapshot: Snapshot;
  list: Affordance[];
  text: string;
  tokens: number;
};

describe.skipIf(!ENABLED)("fixture affordances", () => {
  const apps: FastifyInstance[] = [];
  let engine: PlaywrightEngine | undefined;
  let store = "";
  let wizard = "";
  let portal = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp();
    const wizardApp = await buildWizardApp();
    const portalApp = await buildPortalApp();
    apps.push(storeApp, wizardApp, portalApp);

    store = await listen(storeApp);
    wizard = await listen(wizardApp);
    portal = await listen(portalApp);
  }, 60_000);

  beforeEach(async () => {
    engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
  });

  afterEach(async () => {
    if (engine !== undefined) await engine.close();
    engine = undefined;
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
  });

  function current(): PlaywrightEngine {
    if (engine === undefined) throw new Error("the engine is not running");
    return engine;
  }

  async function capture(url: string): Promise<Capture> {
    await current().navigate(url);
    const snapshot = await current().snapshot();
    const refs = buildRefMap(snapshot.nodes, snapshot.doc);
    const ranked = rankAffordances(snapshot.nodes, { refs });
    const rendered = renderAffordances(ranked.affordances);

    return {
      snapshot,
      list: ranked.affordances,
      text: rendered.text,
      tokens: rendered.tokens,
    };
  }

  function has(list: Affordance[], role: string, name: string): boolean {
    return list.some((affordance) => affordance.role === role && affordance.name === name);
  }

  function target(snapshot: Snapshot, role: string, name: string): number {
    const node = snapshot.nodes.find(
      (candidate) => candidate.role === role && candidate.name === name,
    );
    if (node?.backendNodeId === undefined) {
      throw new Error(`no ${role} named "${name}"`);
    }
    return node.backendNodeId;
  }

  /** Wait for a form submission to finish. Quiescence lands in T2.13. */
  async function waitForPath(path: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const state = await current().evaluate<{ path: string; ready: string }>(
          "({ path: location.pathname, ready: document.readyState })",
        );
        if (state.path === path && state.ready === "complete") return;
      } catch {
        // The document is navigating; try again.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${path}`);
  }

  it("captures the store catalog within budget", async () => {
    const page = await capture(`${store}/`);

    expect(has(page.list, "textbox", "Search products")).toBe(true);
    expect(has(page.list, "button", "Search")).toBe(true);
    expect(
      page.list.some(
        (affordance) => affordance.role === "link" && affordance.name === "Everyday Tee",
      ),
    ).toBe(true);
    expect(page.tokens).toBeLessThanOrEqual(800);
    expect(page.list.every((affordance) => affordance.ref !== undefined)).toBe(true);
    expect(new Set(page.list.map((affordance) => affordance.ref)).size).toBe(page.list.length);
    expect(page.text).toMatch(/^e[0-9a-z]+ /);
  });

  it("captures the store product actions", async () => {
    const page = await capture(`${store}/p/p_101`);

    expect(has(page.list, "combobox", "Size / color")).toBe(true);
    expect(has(page.list, "spinbutton", "Quantity")).toBe(true);
    expect(has(page.list, "button", "Add to cart")).toBe(true);
    expect(page.tokens).toBeLessThanOrEqual(800);
  });

  it("captures every wizard step", async () => {
    const step1 = await capture(`${wizard}/step/1`);
    expect(has(step1.list, "textbox", "Full name")).toBe(true);
    expect(has(step1.list, "textbox", "Work email")).toBe(true);
    expect(has(step1.list, "button", "Continue")).toBe(true);

    await current().dispatch({
      do: "fill",
      backendNodeId: target(step1.snapshot, "textbox", "Full name"),
      value: "Ada",
    });
    await current().dispatch({
      do: "fill",
      backendNodeId: target(step1.snapshot, "textbox", "Work email"),
      value: "ada@example.com",
    });
    await current().dispatch({
      do: "click",
      backendNodeId: target(step1.snapshot, "button", "Continue"),
    });
    await waitForPath("/step/2");

    const step2 = await capture(`${wizard}/step/2`);
    expect(has(step2.list, "textbox", "Company")).toBe(true);
    expect(has(step2.list, "combobox", "Your role")).toBe(true);
    expect(has(step2.list, "spinbutton", "Team size")).toBe(true);

    await current().dispatch({
      do: "fill",
      backendNodeId: target(step2.snapshot, "textbox", "Company"),
      value: "Analytical Engines",
    });
    await current().dispatch({
      do: "select",
      backendNodeId: target(step2.snapshot, "combobox", "Your role"),
      value: "Engineer",
    });
    await current().dispatch({
      do: "fill",
      backendNodeId: target(step2.snapshot, "spinbutton", "Team size"),
      value: "12",
    });
    await current().dispatch({
      do: "click",
      backendNodeId: target(step2.snapshot, "button", "Continue"),
    });
    await waitForPath("/step/3");

    const step3 = await capture(`${wizard}/step/3`);
    expect(step3.list.some((affordance) => /attachment|choose file/i.test(affordance.name))).toBe(
      true,
    );
    expect(
      step3.list.some(
        (affordance) => affordance.role === "checkbox" && /confirm/i.test(affordance.name),
      ),
    ).toBe(true);
    expect(has(step3.list, "button", "Submit application")).toBe(true);
    expect(step3.tokens).toBeLessThanOrEqual(800);
  });

  it("captures the portal login and the authenticated ledger", async () => {
    const login = await capture(`${portal}/login`);
    expect(has(login.list, "textbox", "Email")).toBe(true);
    expect(has(login.list, "textbox", "Password")).toBe(true);
    expect(has(login.list, "button", "Sign in")).toBe(true);

    await current().dispatch({
      do: "fill",
      backendNodeId: target(login.snapshot, "textbox", "Email"),
      value: "analyst@example.com",
    });
    await current().dispatch({
      do: "fill",
      backendNodeId: target(login.snapshot, "textbox", "Password"),
      value: "portolan",
    });
    await current().dispatch({
      do: "click",
      backendNodeId: target(login.snapshot, "button", "Sign in"),
    });
    await waitForPath("/");

    const invoices = await capture(`${portal}/`);
    expect(has(invoices.list, "combobox", "Status")).toBe(true);
    expect(has(invoices.list, "button", "Filter")).toBe(true);
    expect(
      invoices.list.some(
        (affordance) => affordance.role === "link" && affordance.name === "Export CSV",
      ),
    ).toBe(true);
    expect(invoices.tokens).toBeLessThanOrEqual(800);
  });
});
