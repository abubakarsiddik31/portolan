import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { runUiOp, runUrlOp } from "@abubakarsiddiik/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { filterInvoices, login, paginate } from "../oracle/portal.js";
import { getProduct, search } from "../oracle/store.js";

const MAPS = join(import.meta.dirname, "../../maps");
const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const CREDENTIALS = { email: "analyst@example.com", password: "portolan" };

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

describe.skipIf(!ENABLED)("url tier parity", () => {
  const apps: FastifyInstance[] = [];
  let browser: Browser | undefined;
  let store = "";
  let portal = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp();
    const portalApp = await buildPortalApp();
    apps.push(storeApp, portalApp);

    store = await listen(storeApp);
    portal = await listen(portalApp);

    browser = await chromium.launch({ executablePath: chromePath() });
  }, 60_000);

  afterAll(async () => {
    if (browser !== undefined) await browser.close();
    for (const app of apps) await app.close();
  });

  function currentBrowser(): Browser {
    if (browser === undefined) throw new Error("the browser is not running");
    return browser;
  }

  async function withEngine<T>(fn: (engine: PlaywrightEngine) => Promise<T>): Promise<T> {
    const engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
    try {
      return await fn(engine);
    } finally {
      await engine.close();
    }
  }

  it("matches the oracle on search", async () => {
    const storeMap = map("store");
    const context = await currentBrowser().newContext({ baseURL: store });

    try {
      const page = await context.newPage();
      const oracle = await search(page, "tee");

      await withEngine(async (engine) => {
        const runtime = await runUrlOp({
          map: storeMap,
          op: opOf(storeMap, "search"),
          params: { query: "tee" },
          substrate: new Substrate(engine),
          baseUrl: store,
        });

        if (!runtime.ok) throw new Error(runtime.message);
        expect(runtime.result).toEqual(oracle);
      });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on get_product", async () => {
    const storeMap = map("store");
    const context = await currentBrowser().newContext({ baseURL: store });

    try {
      const page = await context.newPage();
      const oracle = await getProduct(page, "p_101");

      await withEngine(async (engine) => {
        const runtime = await runUrlOp({
          map: storeMap,
          op: opOf(storeMap, "get_product"),
          params: { product_id: "p_101" },
          substrate: new Substrate(engine),
          baseUrl: store,
        });

        if (!runtime.ok) throw new Error(runtime.message);

        const result = runtime.result as {
          name: string;
          price: string;
          variants: Array<{ id: string }>;
        };

        expect(result.name).toBe(oracle.name);
        expect(result.price).toBe(oracle.price);
        expect(result.variants.map((variant) => variant.id)).toEqual(oracle.variants);
      });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on filter_invoices", async () => {
    const portalMap = map("portal");
    const context = await currentBrowser().newContext({ baseURL: portal });

    try {
      const page = await context.newPage();
      await login(page, CREDENTIALS);
      const oracle = await filterInvoices(page, "paid");

      await withEngine(async (engine) => {
        const substrate = new Substrate(engine);
        await engine.navigate(`${portal}/login`);
        const loggedIn = await runUiOp({
          map: portalMap,
          op: opOf(portalMap, "login"),
          params: { ...CREDENTIALS },
          substrate,
        });
        if (!loggedIn.ok) throw new Error(loggedIn.message);

        const runtime = await runUrlOp({
          map: portalMap,
          op: opOf(portalMap, "filter_invoices"),
          params: { status: "paid" },
          substrate,
          baseUrl: portal,
        });

        if (!runtime.ok) throw new Error(runtime.message);
        expect(runtime.result).toEqual(oracle);
      });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on paginate", async () => {
    const portalMap = map("portal");
    const context = await currentBrowser().newContext({ baseURL: portal });

    try {
      const page = await context.newPage();
      await login(page, CREDENTIALS);
      const oracle = await paginate(page, 2);

      await withEngine(async (engine) => {
        const substrate = new Substrate(engine);
        await engine.navigate(`${portal}/login`);
        const loggedIn = await runUiOp({
          map: portalMap,
          op: opOf(portalMap, "login"),
          params: { ...CREDENTIALS },
          substrate,
        });
        if (!loggedIn.ok) throw new Error(loggedIn.message);

        const runtime = await runUrlOp({
          map: portalMap,
          op: opOf(portalMap, "paginate"),
          params: { page: 2 },
          substrate,
          baseUrl: portal,
        });

        if (!runtime.ok) throw new Error(runtime.message);
        expect(runtime.result).toEqual(oracle);
      });
    } finally {
      await context.close();
    }
  });
});
