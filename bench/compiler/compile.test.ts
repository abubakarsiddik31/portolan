import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileCandidates, publishMap, repairIntent, verifyOp } from "@portolan/compiler";
import { parseMap, type SiteMap } from "@portolan/protocol";
import { findChrome, PlaywrightEngine, Substrate, type SubstrateView } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { createRepairScript } from "../repair/scripted-model.js";

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
    value: CUSTOMER.name,
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Email",
    do: "fill" as const,
    value: CUSTOMER.email,
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Address",
    do: "fill" as const,
    value: CUSTOMER.address,
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "City",
    do: "fill" as const,
    value: CUSTOMER.city,
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Postal code",
    do: "fill" as const,
    value: CUSTOMER.postal,
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Card number",
    do: "fill" as const,
    value: CUSTOMER.card,
  },
  { kind: "act" as const, role: "button", name: "Place order", do: "click" as const },
  { kind: "done" as const, answer: "Order placed." },
];

const portalLogin = [
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
];

const filterSteps = [
  ...portalLogin,
  { kind: "act" as const, role: "combobox", name: "Status", do: "select" as const, value: "paid" },
  { kind: "act" as const, role: "button", name: "Filter", do: "click" as const },
  { kind: "done" as const, answer: "Filtered." },
];

const paginateSteps = [
  ...portalLogin,
  { kind: "act" as const, role: "link", name: "Next", do: "click" as const },
  { kind: "done" as const, answer: "Paged." },
];

describe.skipIf(!ENABLED)("compile dev fixtures", () => {
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

  async function capture(base: string, url: string): Promise<SubstrateView | undefined> {
    const { engine, substrate } = current();

    try {
      await engine.navigate(url.startsWith("http") ? url : new URL(url, base).toString());
      return await substrate.view();
    } catch {
      return undefined;
    }
  }

  it("compiles store and portal traces into a verified map and reports the gap", async () => {
    const storeMap = map("store");
    const portalMap = map("portal");
    const { engine, substrate } = current();

    await engine.navigate(store);
    const storeRun = await repairIntent({
      model: createRepairScript(storeSteps),
      substrate,
      goal: "Buy one Everyday Tee and place an order.",
      map: storeMap,
      effect: "write",
      maxSteps: 25,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return /\/orders\/ord_\d+$/.test(new URL(url).pathname);
      },
    });
    expect(storeRun.ok).toBe(true);

    await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
    await engine.navigate(portal);
    const filterRun = await repairIntent({
      model: createRepairScript(filterSteps),
      substrate,
      goal: "Filter invoices to paid.",
      map: portalMap,
      effect: "read",
      maxSteps: 10,
    });
    expect(filterRun.ok).toBe(true);

    await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
    await engine.navigate(portal);
    const paginateRun = await repairIntent({
      model: createRepairScript(paginateSteps),
      substrate,
      goal: "Open page 2 of the invoices.",
      map: portalMap,
      effect: "read",
      maxSteps: 10,
    });
    expect(paginateRun.ok).toBe(true);

    const storeCandidates = await compileCandidates({
      map: storeMap,
      traces: [{ trace: storeRun.trace, source: "trace:store-buy" }],
      capture: (url) => capture(store, url),
      outcomeChecks: { add_to_cart: "view_cart" },
    });

    const portalCandidates = await compileCandidates({
      map: portalMap,
      traces: [
        {
          trace: filterRun.trace,
          source: "trace:portal-filter",
          labels: [
            { index: 0, action: "reuse", op: "login", reason: "login" },
            { index: 1, action: "reuse", op: "filter_invoices", reason: "filter" },
          ],
        },
        {
          trace: paginateRun.trace,
          source: "trace:portal-paginate",
          labels: [
            { index: 0, action: "reuse", op: "login", reason: "login" },
            { index: 1, action: "reuse", op: "paginate", reason: "page" },
          ],
        },
      ],
      capture: (url) => capture(portal, url),
    });

    const storeParamSets: Record<string, Array<Record<string, unknown>>> = {
      search: [{ query: "tee" }, { query: "socks" }, { query: "mug" }],
      get_product: [{ product_id: "p_101" }, { product_id: "p_103" }, { product_id: "p_105" }],
      add_to_cart: [
        { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
        { product_id: "p_103", variant_id: "v_103_s_charcoal", qty: 2 },
        { product_id: "p_105", variant_id: "v_105_one_size_enamel", qty: 1 },
      ],
      checkout: [
        CUSTOMER,
        { ...CUSTOMER, name: "Grace Hopper", email: "grace@example.com", card: "5555555555554444" },
        { ...CUSTOMER, name: "Alan Turing", email: "alan@example.com", card: "4000000000000002" },
      ],
    };

    const portalParamSets: Record<string, Array<Record<string, unknown>>> = {
      filter_invoices: [{ status: "paid" }, { status: "pending" }, { status: "overdue" }],
      paginate: [{ page: 2 }, { page: 3 }, { page: 4 }],
    };

    const storeReports = [];
    for (const candidate of storeCandidates) {
      const paramSets = storeParamSets[candidate.op.name];
      if (paramSets === undefined) continue;

      const report = await verifyOp({
        map: storeMap,
        op: candidate.op,
        paramSets,
        baseUrl: store,
        executablePath: CHROME as string,
        ...(candidate.op.name === "checkout"
          ? {
              setup: [
                {
                  op: "add_to_cart",
                  params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
                },
              ],
            }
          : {}),
      });
      storeReports.push({ candidate, report });
    }

    const portalReports = [];
    for (const candidate of portalCandidates) {
      const paramSets = portalParamSets[candidate.op.name];
      if (paramSets === undefined) continue;

      const report = await verifyOp({
        map: portalMap,
        op: candidate.op,
        paramSets,
        baseUrl: portal,
        executablePath: CHROME as string,
        setup: [{ op: "login", params: { email: "analyst@example.com", password: "portolan" } }],
      });
      portalReports.push({ candidate, report });
    }

    const temp = await mkdtemp(join(tmpdir(), "portolan-compile-"));

    try {
      const storeDir = join(temp, "store");
      const portalDir = join(temp, "portal");
      await mkdir(storeDir, { recursive: true });
      await writeFile(join(storeDir, "v1.json"), readFileSync(join(MAPS, "store", "v1.json")));
      await mkdir(portalDir, { recursive: true });
      await writeFile(join(portalDir, "v1.json"), readFileSync(join(MAPS, "portal", "v1.json")));

      const viewCart = storeMap.ops.find((op) => op.name === "view_cart");

      const storePublish = await publishMap({
        dir: storeDir,
        map: { ...storeMap, ops: viewCart === undefined ? [] : [viewCart] },
        candidates: storeReports.map(({ candidate, report }) => ({
          op: candidate.op,
          verified: report.verified,
          ...(candidate.source !== undefined ? { source: candidate.source } : {}),
        })),
      });
      const login = portalMap.ops.find((op) => op.name === "login");

      const portalPublish = await publishMap({
        dir: portalDir,
        map: { ...portalMap, ops: login === undefined ? [] : [login] },
        candidates: portalReports.map(({ candidate, report }) => ({
          op: candidate.op,
          verified: report.verified,
          ...(candidate.source !== undefined ? { source: candidate.source } : {}),
        })),
      });

      const compiledStore = parseMap(await readFile(storePublish.path, "utf8"));
      const compiledPortal = parseMap(await readFile(portalPublish.path, "utf8"));

      const coverage = (oracle: SiteMap, compiled: SiteMap) =>
        oracle.ops.filter((op) => compiled.ops.some((candidate) => candidate.name === op.name))
          .length / oracle.ops.length;

      const tierMix = (siteMap: SiteMap) => {
        const mix: Record<string, number> = { url: 0, http: 0, ui: 0 };
        for (const op of siteMap.ops) {
          const tier = op.impls[0]?.tier;
          if (tier !== undefined) mix[tier] = (mix[tier] ?? 0) + 1;
        }
        return mix;
      };

      const storeYield =
        storeReports.filter(({ report }) => report.verified).length / storeReports.length;
      const portalYield =
        portalReports.filter(({ report }) => report.verified).length / portalReports.length;

      expect(compiledStore.ops.map((op) => op.name).sort()).toEqual(
        ["add_to_cart", "get_product", "search", "view_cart"].sort(),
      );
      expect(storePublish.diff.held).toEqual(["checkout"]);
      expect(storePublish.reviewPath).toBeTypeOf("string");
      expect(compiledPortal.ops.map((op) => op.name).sort()).toEqual(
        ["filter_invoices", "login", "paginate"].sort(),
      );
      expect(coverage(storeMap, compiledStore)).toBeCloseTo(4 / 8);
      expect(coverage(portalMap, compiledPortal)).toBeCloseTo(3 / 4);
      expect(storeYield).toBe(1);
      expect(portalYield).toBe(1);
      expect(tierMix(compiledStore)).toEqual({ url: 3, http: 1, ui: 0 });
      expect(tierMix(storeMap)).toEqual({ url: 4, ui: 2, http: 2 });
      expect(tierMix(compiledPortal)).toEqual({ url: 2, http: 0, ui: 1 });
      expect(tierMix(portalMap)).toEqual({ url: 3, http: 0, ui: 1 });

      const report = renderReport({
        store: {
          oracle: storeMap,
          compiled: compiledStore,
          yield: storeYield,
          held: storePublish.diff.held,
        },
        portal: {
          oracle: portalMap,
          compiled: compiledPortal,
          yield: portalYield,
          held: portalPublish.diff.held,
        },
        coverage,
        tierMix,
      });

      console.log(report);
      await writeFile(join(temp, "compiled-dev.md"), report, "utf8");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 240_000);
});

function renderReport(input: {
  store: { oracle: SiteMap; compiled: SiteMap; yield: number; held: string[] };
  portal: { oracle: SiteMap; compiled: SiteMap; yield: number; held: string[] };
  coverage: (oracle: SiteMap, compiled: SiteMap) => number;
  tierMix: (siteMap: SiteMap) => Record<string, number>;
}): string {
  const rows = [
    ["store", input.store],
    ["portal", input.portal],
  ] as const;

  const lines = [
    "# Compiled dev fixtures",
    "",
    "| Site | Oracle ops | Compiled | Coverage | Yield | Held | Tier mix (compiled) | Tier mix (oracle) |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (const [site, value] of rows) {
    lines.push(
      `| ${site} | ${value.oracle.ops.length} | ${value.compiled.ops.length} | ${(
        input.coverage(value.oracle, value.compiled) * 100
      ).toFixed(0)}% | ${(value.yield * 100).toFixed(0)}% | ${
        value.held.length === 0 ? "—" : value.held.join(", ")
      } | ${mixText(input.tierMix(value.compiled))} | ${mixText(input.tierMix(value.oracle))} |`,
    );
  }

  lines.push("");
  lines.push("Missing ops are the ones no trace exercised or no lift supported:");
  lines.push(
    "- store: `checkout` is irreversible and held for review; `list_products_api` and `get_product_api` were never exercised; `open_checkout` is static and does not lift; `view_cart` is inherited as the write's outcome check.",
  );
  lines.push(
    "- portal: `export_csv` needs download capture; `login` is inherited because the auth block names it.",
  );
  lines.push("- wizard: no trace; file upload is still unsupported.");
  lines.push("");

  return lines.join("\n");
}

function mixText(mix: Record<string, number>): string {
  return Object.entries(mix)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => `${tier} ${count}`)
    .join(", ");
}
