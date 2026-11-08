import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CanaryCheck, CanaryScheduler } from "./canary.js";
import { MapStore } from "./maps.js";
import { SessionStore } from "./store.js";

const MAPS = join(import.meta.dirname, "../../../maps");
const NOW = "2026-11-09T00:00:00.000Z";

describe("CanaryScheduler", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  afterEach(() => {
    store.closeDatabase();
  });

  it("records healthy, degraded, and broken per read op", async () => {
    const check: CanaryCheck = async ({ op, params }) => {
      if (op.name === "search") return { ok: params.query === "tee" };
      if (op.name === "get_product") return { ok: false, message: "product page moved" };
      return { ok: true };
    };

    const scheduler = new CanaryScheduler({
      maps: new MapStore(MAPS),
      store,
      check,
      params: {
        search: [{ query: "tee" }, { query: "socks" }],
        get_product: [{ product_id: "p_101" }],
      },
      now: () => NOW,
    });

    const records = await scheduler.runOnce("store");
    const byOp = new Map(records.map((record) => [record.op, record]));

    expect(byOp.get("search")).toMatchObject({
      status: "degraded",
      map_version: 1,
      checked_at: NOW,
    });
    expect(byOp.get("get_product")).toMatchObject({
      status: "broken",
      message: "product page moved",
    });
    expect(byOp.get("open_checkout")).toMatchObject({ status: "healthy" });
    expect(byOp.get("view_cart")).toMatchObject({ status: "healthy" });
    expect(byOp.has("add_to_cart")).toBe(false);
    expect(byOp.has("list_products_api")).toBe(false);
    expect(store.listOpHealth("store")).toHaveLength(records.length);
  });

  it("marks an op healthy only when every param set passes", async () => {
    const scheduler = new CanaryScheduler({
      maps: new MapStore(MAPS),
      store,
      check: async () => ({ ok: true }),
      params: { search: [{ query: "tee" }, { query: "socks" }] },
      now: () => NOW,
    });

    await scheduler.runOnce("store");

    expect(store.listOpHealth("store").find((record) => record.op === "search")).toMatchObject({
      status: "healthy",
    });
  });

  it("starts and stops its timer", () => {
    const scheduler = new CanaryScheduler({
      maps: new MapStore(MAPS),
      store,
      check: async () => ({ ok: true }),
      intervalMs: 1_000,
    });

    scheduler.start();
    scheduler.stop();
  });
});
