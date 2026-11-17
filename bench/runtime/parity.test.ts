import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { runUiOp } from "@abubakarsiddiik/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildWizardApp } from "../fixtures/wizard/v1/app.js";
import { login } from "../oracle/portal.js";
import { addToCart, checkout } from "../oracle/store.js";
import { submitApplication } from "../oracle/wizard.js";

const MAPS = join(import.meta.dirname, "../../maps");
const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const CUSTOMER = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  address: "1 Analytical Way",
  city: "London",
  postal: "N1 1AA",
  card: "4242424242424242",
};

function map(site: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, site, "v1.json"), "utf8"));
}

function opOf(model: SiteMap, name: string): OpDef {
  const found = model.ops.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no op "${name}"`);
  return found;
}

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

describe.skipIf(!ENABLED)("runtime and oracle parity", () => {
  const apps: FastifyInstance[] = [];
  let browser: Browser | undefined;
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

    browser = await chromium.launch({ executablePath: chromePath() });
    engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    if (browser !== undefined) await browser.close();
    for (const app of apps) await app.close();
  });

  function currentEngine(): PlaywrightEngine {
    if (engine === undefined) throw new Error("the engine is not running");
    return engine;
  }

  function currentBrowser(): Browser {
    if (browser === undefined) throw new Error("the browser is not running");
    return browser;
  }

  it("matches the oracle on the store purchase", async () => {
    const storeMap = map("store");
    const context = await currentBrowser().newContext({ baseURL: store });

    try {
      const page = await context.newPage();

      const oracleCart = await addToCart(page, {
        productId: "p_101",
        variantId: "v_101_m_blue",
        qty: 1,
      });
      const oracleItem = oracleCart.items.at(-1);
      expect(oracleItem).toBeDefined();

      await currentEngine().navigate(`${store}/p/p_101`);
      const substrate = new Substrate(currentEngine());
      const runtime = await runUiOp({
        map: storeMap,
        op: opOf(storeMap, "add_to_cart"),
        params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
        substrate,
      });

      if (!runtime.ok) throw new Error(runtime.message);

      const items = runtime.result as Array<{ name: string; qty: number; total: string }>;
      expect(items.at(-1)).toEqual(oracleItem);

      const oracleOrder = await checkout(page, CUSTOMER);
      expect(oracleOrder.orderId).toMatch(/^ord_\d+$/);

      await currentEngine().navigate(`${store}/checkout`);
      const runtimeOrder = await runUiOp({
        map: storeMap,
        op: opOf(storeMap, "checkout"),
        params: { ...CUSTOMER },
        substrate,
      });

      if (!runtimeOrder.ok) throw new Error(runtimeOrder.message);
      expect(runtimeOrder.result).toMatchObject({
        order_id: expect.stringMatching(/^ord_\d+$/),
      });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on portal login", async () => {
    const portalMap = map("portal");
    const context = await currentBrowser().newContext({ baseURL: portal });

    try {
      const page = await context.newPage();
      await login(page, {
        email: "analyst@example.com",
        password: "portolan",
      });
      expect(new URL(page.url()).pathname).toBe("/");

      await currentEngine().navigate(`${portal}/login`);
      const runtime = await runUiOp({
        map: portalMap,
        op: opOf(portalMap, "login"),
        params: { email: "analyst@example.com", password: "portolan" },
        substrate: new Substrate(currentEngine()),
      });

      expect(runtime).toMatchObject({ ok: true, state: "invoices" });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on the wizard submission", async () => {
    const wizardMap = map("wizard");
    const context = await currentBrowser().newContext({ baseURL: wizard });
    const filePath = join(import.meta.dirname, "../tasks/files/sample.txt");

    try {
      const page = await context.newPage();
      const application = {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        role: "Engineer",
        teamSize: 12,
      };

      const oracleSubmission = await submitApplication(page, application, filePath);
      expect(oracleSubmission.submissionId).toMatch(/^sub_\d+$/);

      await currentEngine().navigate(`${wizard}/step/1`);
      const runtime = await runUiOp({
        map: wizardMap,
        op: opOf(wizardMap, "submit_application"),
        params: {
          name: application.name,
          email: application.email,
          company: application.company,
          role: application.role,
          team_size: application.teamSize,
          file_path: filePath,
        },
        substrate: new Substrate(currentEngine()),
      });

      if (!runtime.ok) throw new Error(runtime.message);
      expect(runtime.result).toMatchObject({
        submission_id: expect.stringMatching(/^sub_\d+$/),
      });
    } finally {
      await context.close();
    }
  });
});
