import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  inferReturns,
  liftUrl,
  parameterizeTrace,
  repairIntent,
  withUrlLift,
} from "@abubakarsiddiik/compiler";
import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { runUrlOp } from "@abubakarsiddiik/runtime";
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

describe.skipIf(!ENABLED)("url lift", () => {
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

  it("lifts store search to a url route and runs it with a new query", async () => {
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
        { kind: "done", answer: "Searched." },
      ]),
      substrate,
      goal: "Search the catalog for tee.",
      map: storeMap,
      effect: "read",
      maxSteps: 5,
    });

    expect(repaired.ok).toBe(true);

    const post = await substrate.view();
    const returns = inferReturns(post);
    const parameterized = parameterizeTrace({ trace: repaired.trace }, storeMap);
    const segment = parameterized.segments.find((candidate) => candidate.op === "search");

    if (segment === undefined) throw new Error("the search segment is missing");

    const lift = liftUrl({ segment, returns });
    if (lift === undefined) throw new Error("the search segment did not lift");

    expect(lift.route).toBe("/search?q={query}");

    const op = storeMap.ops.find((candidate) => candidate.name === "search");
    if (op === undefined) throw new Error("the search op is missing");

    const lifted = withUrlLift(op, lift, returns.schema);
    const result = await runUrlOp({
      map: storeMap,
      op: lifted,
      params: { query: "socks" },
      substrate,
      baseUrl: store,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);

    const rows = result.result as Array<Record<string, unknown>>;
    expect(JSON.stringify(rows)).toContain("Merino Socks");
  }, 120_000);

  it("lifts the portal filter to a url route and runs it with a new status", async () => {
    const portalMap = map("portal");
    const { engine, substrate } = current();
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
        { kind: "act", role: "combobox", name: "Status", do: "select", value: "paid" },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        { kind: "done", answer: "Filtered." },
      ]),
      substrate,
      goal: "Filter invoices to paid.",
      map: portalMap,
      effect: "read",
      maxSteps: 10,
    });

    expect(repaired.ok).toBe(true);

    const post = await substrate.view();
    const returns = inferReturns(post);
    const parameterized = parameterizeTrace(
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
    const segment = parameterized.segments.find((candidate) => candidate.op === "filter_invoices");

    if (segment === undefined) throw new Error("the filter segment is missing");

    const lift = liftUrl({ segment, returns });
    if (lift === undefined) throw new Error("the filter segment did not lift");

    expect(lift.route).toBe("/?status={status}");

    const op = portalMap.ops.find((candidate) => candidate.name === "filter_invoices");
    if (op === undefined) throw new Error("the filter op is missing");

    const lifted = withUrlLift(op, lift, returns.schema);
    const result = await runUrlOp({
      map: portalMap,
      op: lifted,
      params: { status: "pending" },
      substrate,
      baseUrl: portal,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);

    const rows = result.result as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "pending")).toBe(true);
  }, 120_000);
});
