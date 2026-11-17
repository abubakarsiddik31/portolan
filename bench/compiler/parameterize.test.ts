import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parameterizeTrace, parameterizeTraces, repairIntent } from "@abubakarsiddiik/compiler";
import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
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

function customerSteps() {
  return [
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
  ];
}

const teeSteps = [
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
  ...customerSteps(),
  { kind: "act" as const, role: "button", name: "Place order", do: "click" as const },
  { kind: "done" as const, answer: "Order placed." },
];

const socksSteps = [
  {
    kind: "act" as const,
    role: "textbox",
    name: "Search products",
    do: "fill" as const,
    value: "socks",
  },
  { kind: "act" as const, role: "button", name: "Search", do: "click" as const },
  { kind: "act" as const, role: "link", name: "Merino Socks", do: "click" as const },
  {
    kind: "act" as const,
    role: "combobox",
    name: "Size / color",
    do: "select" as const,
    value: "v_103_s_charcoal",
  },
  { kind: "act" as const, role: "spinbutton", name: "Quantity", do: "fill" as const, value: "2" },
  { kind: "act" as const, role: "button", name: "Add to cart", do: "click" as const },
  { kind: "act" as const, role: "link", name: "Checkout", do: "click" as const },
  ...customerSteps(),
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

describe.skipIf(!ENABLED)("parameterizer", () => {
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

  async function storeTrace(
    steps: Parameters<typeof createRepairScript>[0],
  ): Promise<Awaited<ReturnType<typeof repairIntent>>> {
    const { engine, substrate } = current();
    await engine.navigate(store);

    return repairIntent({
      model: createRepairScript(steps),
      substrate,
      goal: "Buy one product and place an order.",
      map: map("store"),
      effect: "write",
      maxSteps: 25,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return /\/orders\/ord_\d+$/.test(new URL(url).pathname);
      },
    });
  }

  it("matches the oracle signature on every store op", async () => {
    const tee = await storeTrace(teeSteps);
    expect(tee.ok).toBe(true);

    const storeMap = map("store");
    const result = parameterizeTrace(
      {
        trace: tee.trace,
        params: { product: "Everyday Tee", size: "M", color: "Blue" },
      },
      storeMap,
    );

    for (const segment of result.segments) {
      if (segment.op === undefined) continue;
      const op = storeMap.ops.find((candidate) => candidate.name === segment.op);
      const expected = op?.params.required;
      expect(segment.params.map((param) => param.name).sort()).toEqual(
        Array.isArray(expected) ? [...expected].sort() : [],
      );
      expect(segment.missing).toEqual([]);
    }

    const search = result.segments.find((segment) => segment.op === "search");
    expect(search?.params).toContainEqual({
      name: "query",
      value: "tee",
      source: "label",
      action: 0,
    });

    const product = result.segments.find((segment) => segment.op === "get_product");
    expect(product?.params).toContainEqual({ name: "product_id", value: "p_101", source: "url" });

    const cart = result.segments.find((segment) => segment.op === "add_to_cart");
    expect(cart?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "product_id", value: "p_101" }),
        expect.objectContaining({ name: "variant_id", value: "v_101_m_blue" }),
        expect.objectContaining({ name: "qty", value: 1 }),
      ]),
    );
  }, 120_000);

  it("diffs two store traces and marks the values that change", async () => {
    const tee = await storeTrace(teeSteps);
    const socks = await storeTrace(socksSteps);

    const storeMap = map("store");
    const [first, second] = parameterizeTraces(
      [
        { trace: tee.trace, params: { product: "Everyday Tee", size: "M", color: "Blue" } },
        { trace: socks.trace, params: { product: "Merino Socks", size: "S", color: "Charcoal" } },
      ],
      storeMap,
    );

    const firstSearch = first?.segments.find((segment) => segment.op === "search");
    const secondSearch = second?.segments.find((segment) => segment.op === "search");

    expect(firstSearch?.params.find((param) => param.name === "query")).toMatchObject({
      value: "tee",
      varying: true,
    });
    expect(secondSearch?.params.find((param) => param.name === "query")).toMatchObject({
      value: "socks",
      varying: true,
    });

    const firstProduct = first?.segments.find((segment) => segment.op === "get_product");
    const secondProduct = second?.segments.find((segment) => segment.op === "get_product");

    expect(firstProduct?.params.find((param) => param.name === "product_id")).toMatchObject({
      value: "p_101",
      varying: true,
    });
    expect(secondProduct?.params.find((param) => param.name === "product_id")).toMatchObject({
      value: "p_103",
      varying: true,
    });

    const firstCart = first?.segments.find((segment) => segment.op === "add_to_cart");
    const secondCart = second?.segments.find((segment) => segment.op === "add_to_cart");

    expect(firstCart?.params.find((param) => param.name === "qty")).toMatchObject({
      value: 1,
      varying: true,
    });
    expect(secondCart?.params.find((param) => param.name === "qty")).toMatchObject({
      value: 2,
      varying: true,
    });

    const firstCheckout = first?.segments.find((segment) => segment.op === "checkout");
    expect(firstCheckout?.params.find((param) => param.name === "name")?.varying).toBeUndefined();
  }, 180_000);

  it("matches the oracle signature on the portal login and filter", async () => {
    const { engine, substrate } = current();
    await engine.navigate(portal);

    const repaired = await repairIntent({
      model: createRepairScript(portalSteps),
      substrate,
      goal: "Sign in and filter invoices to paid.",
      map: map("portal"),
      effect: "read",
      maxSteps: 10,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return new URL(url).searchParams.get("status") === "paid";
      },
    });

    expect(repaired.ok).toBe(true);

    const portalMap = map("portal");
    const result = parameterizeTrace(
      {
        trace: repaired.trace,
        params: { status: "paid" },
        labels: [
          { index: 0, action: "reuse", op: "login", reason: "login" },
          { index: 1, action: "reuse", op: "filter_invoices", reason: "status filter" },
        ],
      },
      portalMap,
    );

    const login = result.segments.find((segment) => segment.op === "login");
    expect(login?.params.map((param) => param.name).sort()).toEqual(["email", "password"]);

    const filter = result.segments.find((segment) => segment.op === "filter_invoices");
    expect(filter?.params).toEqual([{ name: "status", value: "paid", source: "task", action: 0 }]);
    expect(filter?.missing).toEqual([]);
  }, 120_000);
});
