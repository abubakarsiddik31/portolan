import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { runUiOp } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildWizardApp } from "../fixtures/wizard/v1/app.js";

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

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("ui tier", () => {
  const apps: FastifyInstance[] = [];
  let engine: PlaywrightEngine | undefined;
  let store = "";
  let wizard = "";
  let portal = "";

  beforeAll(async () => {
    const storeApp = await buildStoreApp();
    const wizardApp = await buildWizardApp();
    const portalApp = await buildPortalApp();
    apps.push(storeApp, wizardApp, portalApp);

    store = await listen(storeApp);
    wizard = await listen(wizardApp);
    portal = await listen(portalApp);

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

  it("runs add_to_cart and checkout through the ui tier", async () => {
    const storeMap = map("store");
    const substrate = new Substrate(current());
    await current().navigate(`${store}/p/p_101`);

    const add = await runUiOp({
      map: storeMap,
      op: opOf(storeMap, "add_to_cart"),
      params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
      substrate,
    });

    expect(add).toMatchObject({ ok: true, state: "cart" });
    if (!add.ok) throw new Error(add.message);

    const items = add.result as Array<{ name: string }>;
    expect(items[0]?.name).toContain("Everyday Tee");

    await current().navigate(`${store}/checkout`);

    const checkout = await runUiOp({
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

    expect(checkout).toMatchObject({ ok: true, state: "order" });
    if (!checkout.ok) throw new Error(checkout.message);
    expect(checkout.result).toMatchObject({
      order_id: expect.stringMatching(/^ord_/),
    });
  });

  it("runs portal login through the ui tier", async () => {
    const portalMap = map("portal");
    const substrate = new Substrate(current());
    await current().navigate(`${portal}/login`);

    const login = await runUiOp({
      map: portalMap,
      op: opOf(portalMap, "login"),
      params: { email: "analyst@example.com", password: "portolan" },
      substrate,
    });

    expect(login).toMatchObject({ ok: true, state: "invoices" });
  });

  it("runs the wizard upload through the ui tier", async () => {
    const wizardMap = map("wizard");
    const substrate = new Substrate(current());
    await current().navigate(`${wizard}/step/1`);

    const submit = await runUiOp({
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

    expect(submit).toMatchObject({ ok: true, state: "done" });
    if (!submit.ok) throw new Error(submit.message);
    expect(submit.result).toMatchObject({
      submission_id: expect.stringMatching(/^sub_/),
    });
  });
});
