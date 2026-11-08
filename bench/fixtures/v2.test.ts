import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { runUiOp, runUrlOp } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "./portal/v1/app.js";
import { buildStoreApp } from "./store/v1/app.js";
import { buildWizardApp } from "./wizard/v1/app.js";

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

describe.skipIf(!ENABLED)("v2 fixtures", () => {
  const apps: FastifyInstance[] = [];
  let engine: PlaywrightEngine | undefined;
  let store = "";
  let portal = "";
  let wizard = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp({ variant: "v2" });
    const portalApp = await buildPortalApp({ variant: "v2" });
    const wizardApp = await buildWizardApp({ variant: "v2" });
    apps.push(storeApp, portalApp, wizardApp);

    store = await listen(storeApp);
    portal = await listen(portalApp);
    wizard = await listen(wizardApp);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    for (const app of apps) await app.close();
  });

  function current(): { engine: PlaywrightEngine; substrate: Substrate } {
    if (engine === undefined) throw new Error("the engine is not running");
    return { engine, substrate: new Substrate(engine) };
  }

  it("runs the v2 pages with their new labels", async () => {
    const { engine, substrate } = current();

    await engine.navigate(`${store}/catalog?q=tee`);
    const catalog = await substrate.view();
    const catalogText = catalog.snapshot.nodes.map((node) => node.name).join("\n");
    expect(catalogText).toContain("Find products");
    expect(catalogText).toContain("Everyday Tee");

    await engine.navigate(`${portal}/login`);
    const login = await substrate.view();
    expect(login.snapshot.nodes.map((node) => node.name).join("\n")).toContain("Work email");

    await engine.navigate(`${wizard}/apply/1`);
    const step1 = await substrate.view();
    expect(step1.snapshot.nodes.map((node) => node.name).join("\n")).toContain("Name");
  });

  it("breaks the store search when the route moves", async () => {
    const { substrate } = current();
    const storeMap = map("store");

    const result = await runUrlOp({
      map: storeMap,
      op: opOf(storeMap, "search"),
      params: { query: "tee" },
      substrate,
      baseUrl: store,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("breaks the store add-to-cart when the label is renamed", async () => {
    const { engine, substrate } = current();
    const storeMap = map("store");
    await engine.navigate(`${store}/p/p_101`);

    const result = await runUiOp({
      map: storeMap,
      op: opOf(storeMap, "add_to_cart"),
      params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("breaks the store checkout when a modal covers the page", async () => {
    const { engine, substrate } = current();
    const storeMap = map("store");

    await engine.navigate(`${store}/p/p_101`);
    await substrate.fetch({
      method: "POST",
      url: `${store}/api/cart/items`,
      headers: { "content-type": "application/json" },
      body: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
    });
    await engine.navigate(`${store}/checkout`);

    const result = await runUiOp({
      map: storeMap,
      op: opOf(storeMap, "checkout"),
      params: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        address: "1 Analytical Way",
        city: "London",
        postal: "N1 1AA",
        card: "4242424242424242",
      },
      substrate,
    });

    expect(result).toMatchObject({ ok: false });
  });

  it("breaks the portal login when the label is renamed", async () => {
    const { engine, substrate } = current();
    const portalMap = map("portal");
    await engine.navigate(`${portal}/login`);

    const result = await runUiOp({
      map: portalMap,
      op: opOf(portalMap, "login"),
      params: { email: "analyst@example.com", password: "portolan" },
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("breaks the portal filter and pagination when the query keys change", async () => {
    const { engine, substrate } = current();
    const portalMap = map("portal");
    const login = opOf(portalMap, "login");

    const v2Login: OpDef = {
      ...login,
      impls: [
        {
          tier: "ui",
          steps: [
            { do: "fill", target: { label: "Work email" }, value: "{email}" },
            { do: "fill", target: { label: "Password" }, value: "{password}" },
            { do: "click", target: { role: "button", name: "Sign in" } },
            { do: "await_state", state: "invoices" },
          ],
          extract: { kind: "none" },
        },
      ],
    };

    await engine.navigate(`${portal}/login`);
    const signedIn = await runUiOp({
      map: portalMap,
      op: v2Login,
      params: { email: "analyst@example.com", password: "portolan" },
      substrate,
    });
    expect(signedIn).toMatchObject({ ok: true });

    const filtered = await runUrlOp({
      map: portalMap,
      op: opOf(portalMap, "filter_invoices"),
      params: { status: "paid" },
      substrate,
      baseUrl: portal,
    });

    expect(filtered).toMatchObject({ ok: true });
    if (!filtered.ok) throw new Error(filtered.message);

    const rows = filtered.result as Array<{ status: string }>;
    expect(rows.some((row) => row.status !== "paid")).toBe(true);

    const paged = await runUrlOp({
      map: portalMap,
      op: opOf(portalMap, "paginate"),
      params: { page: 2 },
      substrate,
      baseUrl: portal,
    });

    expect(paged).toMatchObject({ ok: true });
    if (!paged.ok) throw new Error(paged.message);

    const pageRows = paged.result as Array<{ id: string }>;
    expect(pageRows.map((row) => row.id)).not.toContain("inv_1011");
  });

  it("breaks the wizard when its route and labels move", async () => {
    const { engine, substrate } = current();
    const wizardMap = map("wizard");
    await engine.navigate(`${wizard}/apply/1`);

    const result = await runUiOp({
      map: wizardMap,
      op: opOf(wizardMap, "submit_application"),
      params: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        role: "Engineer",
        team_size: 12,
        file_path: join(import.meta.dirname, "../tasks/files/sample.txt"),
      },
      substrate,
    });

    expect(result).toMatchObject({ ok: false });
  });
});
