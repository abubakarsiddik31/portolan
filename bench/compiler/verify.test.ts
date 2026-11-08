import { readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyOp } from "@portolan/compiler";
import { parseMap, type SiteMap } from "@portolan/protocol";
import { findChrome } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";

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

describe.skipIf(!ENABLED)("verifier", () => {
  let storeApp: FastifyInstance | undefined;
  let store = "";

  beforeAll(async () => {
    storeApp = await buildStoreApp();
    store = await listen(storeApp);
  }, 30_000);

  afterAll(async () => {
    await storeApp?.close();
  });

  it("verifies the store search on three fresh sessions", async () => {
    const storeMap = map("store");
    const search = storeMap.ops.find((op) => op.name === "search");
    if (search === undefined) throw new Error("the search op is missing");

    const report = await verifyOp({
      map: storeMap,
      op: search,
      paramSets: [{ query: "tee" }, { query: "socks" }, { query: "mug" }],
      baseUrl: store,
      executablePath: CHROME as string,
    });

    expect(report.verified).toBe(true);
    expect(report.impls[0]).toMatchObject({ tier: "url", verified: true });
    expect(report.impls[0]?.runs).toHaveLength(3);
    expect(report.impls[0]?.runs.every((run) => run.ok)).toBe(true);
  }, 120_000);

  it("rejects an impl whose post state does not hold", async () => {
    const storeMap = map("store");
    const search = storeMap.ops.find((op) => op.name === "search");
    if (search === undefined) throw new Error("the search op is missing");

    const report = await verifyOp({
      map: storeMap,
      op: { ...search, post: [{ kind: "state", state: "product" }] },
      paramSets: [{ query: "tee" }, { query: "socks" }, { query: "mug" }],
      baseUrl: store,
      executablePath: CHROME as string,
    });

    expect(report.verified).toBe(false);
    expect(report.impls[0]).toMatchObject({ tier: "url", verified: false });
    expect(report.impls[0]?.reason).toContain("expected state");
  }, 120_000);

  it("verifies a lifted http write with its outcome check on three fresh carts", async () => {
    const storeMap = map("store");
    const addToCart = storeMap.ops.find((op) => op.name === "add_to_cart");
    if (addToCart === undefined) throw new Error("the add-to-cart op is missing");

    const op = {
      ...addToCart,
      post: [],
      outcome_check: "view_cart",
      returns: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          cart_count: { type: "integer" },
          subtotal_cents: { type: "integer" },
          redirect: { type: "string" },
        },
        required: ["ok", "cart_count", "subtotal_cents", "redirect"],
        additionalProperties: false,
      },
      impls: [
        {
          tier: "http" as const,
          steps: [
            {
              method: "POST" as const,
              url: "/api/cart/items",
              headers: { "content-type": "application/json" },
              body: {
                product_id: "{product_id}",
                variant_id: "{variant_id}",
                qty: "{qty}",
              },
            },
          ],
          extract: { kind: "json" as const, path: "" },
        },
      ],
    };

    const report = await verifyOp({
      map: storeMap,
      op,
      paramSets: [
        { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
        { product_id: "p_103", variant_id: "v_103_s_charcoal", qty: 2 },
        { product_id: "p_105", variant_id: "v_105_one_size_enamel", qty: 1 },
      ],
      baseUrl: store,
      executablePath: CHROME as string,
    });

    expect(report.verified).toBe(true);
    expect(report.impls[0]).toMatchObject({ tier: "http", verified: true });
    expect(report.impls[0]?.runs).toHaveLength(3);
    expect(report.impls[0]?.runs.every((run) => run.ok && run.check?.ok === true)).toBe(true);
  }, 180_000);
});
