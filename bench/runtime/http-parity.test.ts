import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { runHttpOp } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { type Browser, chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { getProduct, search } from "../oracle/store.js";

const MAPS = join(import.meta.dirname, "../../maps");
const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

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

function cents(price: string): number {
  return Math.round(Number(price.replace(/[^0-9.]/g, "")) * 100);
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("http tier parity", () => {
  const apps: FastifyInstance[] = [];
  let browser: Browser | undefined;
  let store = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp();
    apps.push(storeApp);
    store = await listen(storeApp);
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
      await engine.navigate(`${store}/`);
      return await fn(engine);
    } finally {
      await engine.close();
    }
  }

  it("matches the oracle on the product list through the http tier", async () => {
    const storeMap = map("store");
    const context = await currentBrowser().newContext({ baseURL: store });

    try {
      const page = await context.newPage();
      const oracle = await search(page, "tee");

      await withEngine(async (engine) => {
        const runtime = await runHttpOp({
          map: storeMap,
          op: opOf(storeMap, "list_products_api"),
          params: { query: "tee" },
          substrate: new Substrate(engine),
          baseUrl: store,
        });

        if (!runtime.ok) throw new Error(runtime.message);

        const products = runtime.result as Array<{
          id: string;
          name: string;
          price_cents: number;
        }>;

        expect(
          products.map((product) => ({
            id: product.id,
            name: product.name,
            price_cents: product.price_cents,
          })),
        ).toEqual(
          oracle.map((product) => ({
            id: product.id,
            name: product.name,
            price_cents: cents(product.price),
          })),
        );
      });
    } finally {
      await context.close();
    }
  });

  it("matches the oracle on get_product through the http tier and a bind", async () => {
    const storeMap = map("store");
    const context = await currentBrowser().newContext({ baseURL: store });

    try {
      const page = await context.newPage();
      const oracle = await getProduct(page, "p_101");

      await withEngine(async (engine) => {
        const runtime = await runHttpOp({
          map: storeMap,
          op: opOf(storeMap, "get_product_api"),
          params: { product_id: "p_101" },
          substrate: new Substrate(engine),
          baseUrl: store,
        });

        if (!runtime.ok) throw new Error(runtime.message);

        const product = runtime.result as {
          id: string;
          name: string;
          price_cents: number;
        };

        expect(product.id).toBe(oracle.id);
        expect(product.name).toBe(oracle.name);
        expect(product.price_cents).toBe(cents(oracle.price));
      });
    } finally {
      await context.close();
    }
  });

  it("reports a non-2xx response", async () => {
    const storeMap = map("store");

    await withEngine(async (engine) => {
      const runtime = await runHttpOp({
        map: storeMap,
        op: opOf(storeMap, "get_product_api"),
        params: { product_id: "nope" },
        substrate: new Substrate(engine),
        baseUrl: store,
      });

      expect(runtime).toMatchObject({ ok: false, code: "op_broken" });
      if (runtime.ok) throw new Error("expected a failure");
      expect(runtime.message).toContain("404");
    });
  });
});
