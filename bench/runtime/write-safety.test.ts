import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { MemoryWriteLedger, runUiOp, runWrite, type WriteExecution } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";

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

async function orderCount(engine: PlaywrightEngine): Promise<number> {
  const data = await engine.evaluate<{ orders: unknown[] }>(
    "fetch('/api/orders').then((response) => response.json())",
  );
  return data.orders.length;
}

describe.skipIf(!ENABLED)("mid-write failure", () => {
  const apps: FastifyInstance[] = [];
  let engine: PlaywrightEngine | undefined;
  let store = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp();
    apps.push(storeApp);
    store = await listen(storeApp);
    engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    for (const app of apps) await app.close();
  });

  function current(): PlaywrightEngine {
    if (engine === undefined) throw new Error("the engine is not running");
    return engine;
  }

  it("returns unknown_outcome and never creates a second order", async () => {
    const storeMap = map("store");
    const checkout = opOf(storeMap, "checkout");
    const engine = current();
    const substrate = new Substrate(engine);

    await engine.navigate(`${store}/p/p_101`);
    const added = await runUiOp({
      map: storeMap,
      op: opOf(storeMap, "add_to_cart"),
      params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
      substrate,
    });
    if (!added.ok) throw new Error(added.message);

    await engine.navigate(`${store}/checkout`);

    // Let the checkout request reach the server, then lose the response.
    await engine.evaluate(`(() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original.apply(window, args);
        if (String(args[0]).includes("/api/checkout")) {
          throw new Error("simulated lost response");
        }
        return response;
      };
    })()`);

    let executions = 0;

    const execute = async (): Promise<WriteExecution> => {
      executions += 1;

      const result = await runUiOp({
        map: storeMap,
        op: checkout,
        params: { ...CUSTOMER },
        substrate,
      });

      if (result.ok) return { ok: true, result: result.result };

      const details = "details" in result ? result.details : undefined;

      return {
        ok: false,
        code:
          result.code === "invalid_params"
            ? "invalid_params"
            : result.code === "precondition_failed"
              ? "precondition_failed"
              : "op_broken",
        message: result.message,
        ...(details !== undefined ? { details } : {}),
      };
    };

    const ledger = new MemoryWriteLedger();
    const first = await runWrite({
      map: storeMap,
      op: checkout,
      confirm: true,
      idempotencyKey: "order-1",
      execute,
      ledger,
    });

    expect(first).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(executions).toBe(1);
    expect(await orderCount(engine)).toBe(1);

    const second = await runWrite({
      map: storeMap,
      op: checkout,
      confirm: true,
      idempotencyKey: "order-1",
      execute,
      ledger,
    });

    expect(second).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(executions).toBe(1);
    expect(await orderCount(engine)).toBe(1);
  });
});
