import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  inferReturns,
  nameReturns,
  repairIntent,
  validateInferredReturns,
} from "@portolan/compiler";
import type { ModelPort, ObjectResult, Usage } from "@portolan/model";
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

const USAGE: Usage = {
  input: 0,
  cached_input: 0,
  output: 0,
  provider: "scripted",
  model: "scripted",
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

function scriptedNames(fields: Record<string, string>): ModelPort {
  return {
    async object<T>(): Promise<ObjectResult<T>> {
      return { value: { fields } as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the name model does not implement agent()");
    },
  };
}

describe.skipIf(!ENABLED)("returns inference", () => {
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

  async function search(query: string): Promise<SubstrateView> {
    const { engine, substrate } = current();
    const storeMap = map("store");
    await engine.navigate(store);

    const repaired = await repairIntent({
      model: createRepairScript([
        {
          kind: "act",
          role: "textbox",
          name: "Search products",
          do: "fill",
          value: query,
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "done", answer: `Searched for ${query}.` },
      ]),
      substrate,
      goal: `Search the catalog for ${query}.`,
      map: storeMap,
      effect: "read",
      maxSteps: 5,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return new URL(url).pathname === "/search";
      },
    });

    expect(repaired.ok).toBe(true);
    return substrate.view();
  }

  async function filterPortal(status: string): Promise<SubstrateView> {
    const { engine, substrate } = current();
    const portalMap = map("portal");

    // A fresh session: the fixture keeps the login cookie in this context.
    await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
    await engine.navigate(portal);

    const repaired = await repairIntent({
      model: createRepairScript([
        {
          kind: "act",
          role: "textbox",
          name: "Email",
          do: "fill",
          value: "analyst@example.com",
        },
        { kind: "act", role: "textbox", name: "Password", do: "fill", value: "portolan" },
        { kind: "act", role: "button", name: "Sign in", do: "click" },
        { kind: "act", role: "combobox", name: "Status", do: "select", value: status },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        { kind: "done", answer: `Filtered to ${status}.` },
      ]),
      substrate,
      goal: `Filter invoices to ${status}.`,
      map: portalMap,
      effect: "read",
      maxSteps: 10,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        return new URL(url).searchParams.get("status") === status;
      },
    });

    expect(repaired.ok).toBe(true);
    return substrate.view();
  }

  it("validates inferred store rows on a held-back search", async () => {
    const inferred = inferReturns(await search("tee"));

    expect(inferred.kind).toBe("rows");
    expect(inferred.extractor).toMatchObject({
      kind: "rows",
      container: { test_id: "product-grid" },
      row: { test_id: "product-card" },
    });
    expect(inferred.value).toHaveLength(1);

    const heldBack = await search("socks");

    expect(validateInferredReturns(inferred, heldBack)).toMatchObject({ ok: true });
  }, 120_000);

  it("validates inferred portal rows on a held-back filter", async () => {
    const inferred = inferReturns(await filterPortal("paid"));

    expect(inferred.kind).toBe("rows");
    expect(inferred.extractor).toMatchObject({
      kind: "rows",
      container: { test_id: "invoice-table" },
      row: { test_id: "invoice-row" },
    });

    const heldBack = await filterPortal("pending");

    expect(validateInferredReturns(inferred, heldBack)).toMatchObject({ ok: true });
  }, 120_000);

  it("renames inferred portal fields and still validates the held-back run", async () => {
    const inferred = inferReturns(await filterPortal("paid"));

    const named = await nameReturns({
      model: scriptedNames({ invoice: "id", amount: "total" }),
      inferred,
    });

    expect(named.inferred.extractor).toMatchObject({
      kind: "rows",
      cols: {
        id: { role: "cell", ordinal: 0 },
        total: { role: "cell", ordinal: 3 },
      },
    });

    const heldBack = await filterPortal("pending");

    expect(validateInferredReturns(named.inferred, heldBack)).toMatchObject({ ok: true });
  }, 120_000);
});
