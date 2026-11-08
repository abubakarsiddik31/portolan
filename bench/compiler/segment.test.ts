import { readFileSync } from "node:fs";
import { join } from "node:path";

import { labelSegments, repairIntent, segmentTrace } from "@portolan/compiler";
import { parseMap, type SiteMap } from "@portolan/protocol";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
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

const storeSteps = [
  {
    kind: "act" as const,
    role: "textbox",
    name: "Search products",
    do: "fill" as const,
    value: "tee",
  },
  { kind: "act" as const, role: "button", name: "Search", do: "click" as const },
  { kind: "act" as const, role: "link", name: "Everyday Tee", do: "click" as const },
  {
    kind: "act" as const,
    role: "combobox",
    name: "Size / color",
    do: "select" as const,
    value: "v_101_m_blue",
  },
  { kind: "act" as const, role: "spinbutton", name: "Quantity", do: "fill" as const, value: "1" },
  { kind: "act" as const, role: "button", name: "Add to cart", do: "click" as const },
  { kind: "act" as const, role: "link", name: "Checkout", do: "click" as const },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Full name",
    do: "fill" as const,
    value: "Ada Lovelace",
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Email",
    do: "fill" as const,
    value: "ada@example.com",
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Address",
    do: "fill" as const,
    value: "1 Analytical Way",
  },
  { kind: "act" as const, role: "textbox", name: "City", do: "fill" as const, value: "London" },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Postal code",
    do: "fill" as const,
    value: "N1 1AA",
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Card number",
    do: "fill" as const,
    value: "4242424242424242",
  },
  { kind: "act" as const, role: "button", name: "Place order", do: "click" as const },
  { kind: "done" as const, answer: "Order placed." },
];

const portalSteps = [
  {
    kind: "act" as const,
    role: "textbox",
    name: "Email",
    do: "fill" as const,
    value: "analyst@example.com",
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Password",
    do: "fill" as const,
    value: "portolan",
  },
  { kind: "act" as const, role: "button", name: "Sign in", do: "click" as const },
  { kind: "act" as const, role: "combobox", name: "Status", do: "select" as const, value: "paid" },
  { kind: "act" as const, role: "button", name: "Filter", do: "click" as const },
  { kind: "done" as const, answer: "Filtered to paid." },
];

describe.skipIf(!ENABLED)("segmenter", () => {
  let storeApp: FastifyInstance | undefined;
  let portalApp: FastifyInstance | undefined;
  let store = "";
  let portal = "";
  let engine: PlaywrightEngine | undefined;

  beforeAll(async () => {
    storeApp = await buildStoreApp();
    portalApp = await buildPortalApp();
    store = await listen(storeApp);
    portal = await listen(portalApp);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await storeApp?.close();
    await portalApp?.close();
  });

  function current(): { engine: PlaywrightEngine; substrate: Substrate } {
    if (engine === undefined) throw new Error("the engine is not running");
    return { engine, substrate: new Substrate(engine) };
  }

  it("cuts the store trace at the oracle's five op boundaries", async () => {
    const storeMap = map("store");
    const { engine, substrate } = current();
    await engine.navigate(store);

    const repaired = await repairIntent({
      model: createRepairScript(storeSteps),
      substrate,
      goal: "Buy one Everyday Tee in M / Blue and place an order.",
      map: storeMap,
      effect: "write",
      maxSteps: 25,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return /\/orders\/ord_\d+$/.test(new URL(url).pathname);
      },
    });

    expect(repaired.ok).toBe(true);

    const segments = segmentTrace(repaired.trace, storeMap);

    expect(segments.map((segment) => segment.candidate)).toEqual([
      "search",
      "get_product",
      "add_to_cart",
      "open_checkout",
      "checkout",
    ]);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [2, 2],
      [3, 5],
      [6, 6],
      [7, 13],
    ]);
  }, 120_000);

  it("cuts the portal login and filter at the oracle's two op boundaries", async () => {
    const portalMap = map("portal");
    const { engine, substrate } = current();
    await engine.navigate(portal);

    const repaired = await repairIntent({
      model: createRepairScript(portalSteps),
      substrate,
      goal: "Sign in and filter invoices to paid.",
      map: portalMap,
      effect: "read",
      maxSteps: 10,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return new URL(url).searchParams.get("status") === "paid";
      },
    });

    expect(repaired.ok).toBe(true);

    const segments = segmentTrace(repaired.trace, portalMap);

    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 2],
      [3, 4],
    ]);
    expect(segments[0]?.candidate).toBe("login");
    expect(segments[1]?.candidate).toBeUndefined();
  }, 120_000);

  it("labels the store segments against the map", async () => {
    const storeMap = map("store");
    const { engine, substrate } = current();
    await engine.navigate(store);

    const repaired = await repairIntent({
      model: createRepairScript(storeSteps),
      substrate,
      goal: "Buy one Everyday Tee in M / Blue and place an order.",
      map: storeMap,
      effect: "write",
      maxSteps: 25,
    });
    const segments = segmentTrace(repaired.trace, storeMap);

    const labels = await labelSegments({
      model: {
        async object<T>() {
          return {
            value: {
              segments: segments.map((segment) => ({
                index: segment.index,
                action: "reuse" as const,
                op: segment.candidate,
                reason: "matches the map",
              })),
            } as T,
            usage: {
              input: 1,
              cached_input: 0,
              output: 1,
              provider: "scripted",
              model: "scripted",
            },
          };
        },
        async agent() {
          throw new Error("the label model does not implement agent()");
        },
      },
      map: storeMap,
      segments,
    });

    expect(labels.labels.map((label) => label.op)).toEqual([
      "search",
      "get_product",
      "add_to_cart",
      "open_checkout",
      "checkout",
    ]);
  }, 120_000);
});
