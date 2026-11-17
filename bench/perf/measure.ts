import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import { runHttpOp, runUiOp, runUrlOp } from "@abubakarsiddiik/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";

import { buildStoreApp } from "../fixtures/store/v1/app.js";

export type Tier = "url" | "http" | "ui";

export type PerfSample = {
  site: string;
  op: string;
  tier: Tier;
  runs: number;
  p50: number;
  p95: number;
  max: number;
  ok: boolean;
};

export type PerfOptions = {
  runs?: number;
  /** The repo root, for the map files. */
  root?: string;
};

const DEFAULTS: Record<Tier, number> = { ui: 500, url: 150, http: 150 };

export function budget(tier: Tier): number {
  return DEFAULTS[tier];
}

export async function measurePerf(options: PerfOptions = {}): Promise<PerfSample[]> {
  const runs = options.runs ?? 10;
  const root = options.root ?? join(import.meta.dirname, "../..");

  const chrome = findChrome();
  if (chrome === undefined) {
    throw new Error("perf needs Chrome; install it or set CHROME_PATH");
  }

  const storeMap = mapAt(root, "store");
  const storeApp = await buildStoreApp();
  const storeUrl = await listen(storeApp);
  const engine = await PlaywrightEngine.launch({ executablePath: chrome });
  const substrate = new Substrate(engine);

  try {
    await engine.navigate(storeUrl);

    const samples: PerfSample[] = [
      await time("store", "search", "url", runs, () =>
        runUrlOp({
          map: storeMap,
          op: opNamed(storeMap, "search"),
          params: { query: "tee" },
          substrate,
          baseUrl: storeUrl,
        }),
      ),
      await time("store", "get_product", "url", runs, () =>
        runUrlOp({
          map: storeMap,
          op: opNamed(storeMap, "get_product"),
          params: { product_id: "p_101" },
          substrate,
          baseUrl: storeUrl,
        }),
      ),
      await time("store", "list_products_api", "http", runs, () =>
        runHttpOp({
          map: storeMap,
          op: opNamed(storeMap, "list_products_api"),
          params: { query: "tee" },
          substrate,
          baseUrl: storeUrl,
        }),
      ),
      await time("store", "get_product_api", "http", runs, () =>
        runHttpOp({
          map: storeMap,
          op: opNamed(storeMap, "get_product_api"),
          params: { product_id: "p_101" },
          substrate,
          baseUrl: storeUrl,
        }),
      ),
      await time(
        "store",
        "add_to_cart",
        "ui",
        runs,
        () =>
          runUiOp({
            map: storeMap,
            op: opNamed(storeMap, "add_to_cart"),
            params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 1 },
            substrate,
          }),
        () => engine.navigate(`${storeUrl}/p/p_101`),
      ),
    ];

    return samples;
  } finally {
    await engine.close();
    await storeApp.close();
  }
}

async function time(
  site: string,
  op: string,
  tier: Tier,
  runs: number,
  run: () => Promise<{ ok: boolean }>,
  setup?: () => Promise<unknown>,
): Promise<PerfSample> {
  const durations: number[] = [];
  let ok = true;

  // One warm-up run, not counted: the first navigation pays for JIT and DNS.
  if (setup !== undefined) await setup();
  const warm = await run();
  if (!warm.ok) ok = false;

  for (let index = 0; index < runs; index += 1) {
    if (setup !== undefined) await setup();
    const start = performance.now();
    const result = await run();
    durations.push(performance.now() - start);
    if (!result.ok) ok = false;
  }

  const sorted = [...durations].sort((a, b) => a - b);

  return {
    site,
    op,
    tier,
    runs,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
    ok,
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return Math.round((sorted[index] ?? 0) * 10) / 10;
}

function opNamed(map: SiteMap, name: string): OpDef {
  const op = map.ops.find((candidate) => candidate.name === name);
  if (op === undefined) throw new Error(`no op "${name}" in ${map.site}`);
  return op;
}

function mapAt(root: string, site: string): SiteMap {
  return parseMap(readFileSync(join(root, "maps", site, "v1.json"), "utf8"));
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}
