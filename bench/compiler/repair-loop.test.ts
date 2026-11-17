import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repairIntent, repairOp } from "@abubakarsiddiik/compiler";
import { type OpDef, parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { createRepairScript } from "../repair/scripted-model.js";

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

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("repair loop", () => {
  let storeApp: FastifyInstance | undefined;
  let store = "";
  let engine: PlaywrightEngine | undefined;

  beforeAll(async () => {
    storeApp = await buildStoreApp({ variant: "v2" });
    store = await listen(storeApp);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await storeApp?.close();
  });

  it("repairs a broken search and a broken add-to-cart without a hand edit", async () => {
    const storeMap = map("store");
    if (engine === undefined) throw new Error("the engine is not running");
    const active = engine;
    const substrate = new Substrate(active);
    const temp = await mkdtemp(join(tmpdir(), "portolan-repair-"));

    try {
      const storeDir = join(temp, "store");
      await mkdir(storeDir, { recursive: true });
      await writeFile(join(storeDir, "v1.json"), readFileSync(join(MAPS, "store", "v1.json")));

      const search = await repairOp({
        map: storeMap,
        op: opOf(storeMap, "search"),
        intent: "Search the catalog for tee.",
        params: { query: "tee" },
        paramSets: [{ query: "tee" }, { query: "socks" }, { query: "mug" }],
        post: [],
        dir: storeDir,
        baseUrl: store,
        executablePath: CHROME as string,
        capture: async (url) => {
          await active.navigate(url);
          return substrate.view();
        },
        repair: async () => {
          await active.navigate(store);
          const run = await repairIntent({
            model: createRepairScript([
              {
                kind: "act",
                role: "textbox",
                name: "Find products",
                do: "fill",
                value: "tee",
              },
              { kind: "act", role: "button", name: "Find", do: "click" },
              { kind: "done", answer: "Searched." },
            ]),
            substrate,
            goal: "Search the catalog for tee.",
            map: storeMap,
            effect: "read",
            maxSteps: 5,
            check: async () => {
              const url = await active.evaluate<string>("location.href");
              return new URL(url).pathname === "/catalog";
            },
          });

          expect(run.ok).toBe(true);
          return run.trace;
        },
      });

      expect(search).toMatchObject({ repaired: true });
      expect(search.verification?.verified).toBe(true);
      expect(search.published?.version).toBe(2);

      const v2 = parseMap(await readFile(join(storeDir, "v2.json"), "utf8"));
      expect(v2.ops.find((op) => op.name === "search")?.impls[0]).toMatchObject({
        tier: "url",
        route: "/catalog?q={query}",
      });

      const cart = await repairOp({
        map: v2,
        op: opOf(v2, "add_to_cart"),
        intent: "Add one Everyday Tee in M / Blue to the cart.",
        params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
        paramSets: [
          { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
          { product_id: "p_103", variant_id: "v_103_s_charcoal", qty: 2 },
          { product_id: "p_105", variant_id: "v_105_one_size_enamel", qty: 1 },
        ],
        outcomeChecks: { add_to_cart: "view_cart" },
        dir: storeDir,
        baseUrl: store,
        executablePath: CHROME as string,
        capture: async (url) => {
          await active.navigate(url);
          return substrate.view();
        },
        repair: async () => {
          await active.navigate(`${store}/p/p_101`);
          const run = await repairIntent({
            model: createRepairScript([
              {
                kind: "act",
                role: "combobox",
                name: "Size and color",
                do: "select",
                value: "v_101_m_blue",
              },
              { kind: "act", role: "spinbutton", name: "Quantity", do: "fill", value: "1" },
              { kind: "act", role: "button", name: "Add to bag", do: "click" },
              { kind: "done", answer: "Added." },
            ]),
            substrate,
            goal: "Add one Everyday Tee in M / Blue to the cart.",
            map: v2,
            effect: "write",
            maxSteps: 8,
            check: async () => {
              const url = await active.evaluate<string>("location.href");
              return new URL(url).pathname === "/cart";
            },
          });

          expect(run.ok).toBe(true);
          return run.trace;
        },
      });

      expect(cart).toMatchObject({ repaired: true });
      expect(cart.verification?.verified).toBe(true);
      expect(cart.published?.version).toBe(3);

      const v3 = parseMap(await readFile(join(storeDir, "v3.json"), "utf8"));
      const repairedCart = v3.ops.find((op) => op.name === "add_to_cart");
      expect(repairedCart?.impls[0]).toMatchObject({ tier: "http" });
      expect(repairedCart?.outcome_check).toBe("view_cart");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 240_000);
});
