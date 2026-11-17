import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  inferJsonReturns,
  liftHttp,
  parameterizeTrace,
  repairIntent,
  withHttpLift,
} from "@abubakarsiddiik/compiler";
import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { MemoryWriteLedger, runHttpOp, runUrlOp, runWrite } from "@abubakarsiddiik/runtime";
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

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("http lift", () => {
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

  it("lifts add-to-cart to http and reconciles a lost response with view_cart", async () => {
    const storeMap = map("store");
    const { engine, substrate } = current();
    await engine.navigate(store);

    const repaired = await repairIntent({
      model: createRepairScript([
        {
          kind: "act",
          role: "textbox",
          name: "Search products",
          do: "fill",
          value: "tee",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: "Everyday Tee", do: "click" },
        {
          kind: "act",
          role: "combobox",
          name: "Size / color",
          do: "select",
          value: "v_101_m_blue",
        },
        { kind: "act", role: "spinbutton", name: "Quantity", do: "fill", value: "1" },
        { kind: "act", role: "button", name: "Add to cart", do: "click" },
        { kind: "done", answer: "Added." },
      ]),
      substrate,
      goal: "Add one Everyday Tee in M / Blue to the cart.",
      map: storeMap,
      effect: "write",
      maxSteps: 12,
    });

    expect(repaired.ok).toBe(true);

    const parameterized = parameterizeTrace({ trace: repaired.trace }, storeMap);
    const segment = parameterized.segments.find((candidate) => candidate.op === "add_to_cart");

    if (segment === undefined) throw new Error("the add-to-cart segment is missing");

    const effect = segment.segment.actions
      .flatMap((action) => action.effects)
      .find((candidate) => candidate.kind === "network" && candidate.method !== "GET");

    if (effect === undefined || effect.kind !== "network") {
      throw new Error("the write request was not captured");
    }

    const returns = inferJsonReturns(effect.response_body);
    const lift = liftHttp({ segment, returns, outcomeCheck: "view_cart" });
    if (lift === undefined) throw new Error("the write segment did not lift");

    expect(lift.steps).toEqual([
      {
        method: "POST",
        url: "/api/cart/items",
        headers: { "content-type": "application/json" },
        body: { product_id: "{product_id}", variant_id: "{variant_id}", qty: "{qty}" },
      },
    ]);

    const op = storeMap.ops.find((candidate) => candidate.name === "add_to_cart");
    if (op === undefined) throw new Error("the add-to-cart op is missing");

    const lifted = withHttpLift(op, lift, returns.schema, "view_cart");
    expect(lifted.outcome_check).toBe("view_cart");

    const viewCart = storeMap.ops.find((candidate) => candidate.name === "view_cart");
    if (viewCart === undefined) throw new Error("the view_cart op is missing");

    // A fresh context means a fresh cart: the trace's cart is not reused.
    const verifyEngine = await PlaywrightEngine.launch({ executablePath: CHROME as string });

    try {
      await verifyEngine.navigate(store);
      const verify = new Substrate(verifyEngine);
      const params = { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 };

      const lossy = Object.create(verify) as Substrate;
      lossy.fetch = async (request) => {
        const response = await verify.fetch(request);
        if (request.method !== "GET") throw new Error("simulated lost response");
        return response;
      };

      const ledger = new MemoryWriteLedger();
      let executions = 0;

      const result = await runWrite({
        map: storeMap,
        op: lifted,
        idempotencyKey: "cart-1",
        ledger,
        execute: async () => {
          executions += 1;
          const response = await runHttpOp({
            map: storeMap,
            op: lifted,
            params,
            substrate: lossy,
            baseUrl: store,
          });

          return response.ok
            ? { ok: true, result: response.result }
            : { ok: false, code: "op_broken", message: response.message };
        },
        check: async () => {
          const cart = await runUrlOp({
            map: storeMap,
            op: viewCart,
            params: {},
            substrate: verify,
            baseUrl: store,
          });

          if (!cart.ok) return { outcome: "unknown" };

          const items = (cart.result as { items?: Array<{ name?: string }> }).items ?? [];
          return items.some((item) => item.name?.includes("Everyday Tee"))
            ? { outcome: "done", result: cart.result }
            : { outcome: "not_done" };
        },
      });

      expect(result).toMatchObject({ ok: true, replayed: true });
      expect(executions).toBe(1);

      const second = await runWrite({
        map: storeMap,
        op: lifted,
        idempotencyKey: "cart-1",
        ledger,
        execute: async () => {
          executions += 1;
          return { ok: true, result: {} };
        },
        check: async () => ({ outcome: "unknown" }),
      });

      expect(second).toMatchObject({ ok: true, replayed: true });
      expect(executions).toBe(1);

      const cart = await runUrlOp({
        map: storeMap,
        op: viewCart,
        params: {},
        substrate: verify,
        baseUrl: store,
      });

      expect(cart).toMatchObject({ ok: true });
      if (!cart.ok) throw new Error(cart.message);

      const items = (cart.result as { items: Array<{ name: string; qty: number }> }).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ name: "Everyday Tee", qty: 1 });
    } finally {
      await verifyEngine.close();
    }
  }, 180_000);
});
