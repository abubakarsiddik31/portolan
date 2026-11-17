import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportSkill, mineRecipes, validateSkill, validateSkillDir } from "./export.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function map(): SiteMap {
  return parseMap(readFileSync(join(MAPS, "store", "v1.json"), "utf8"));
}

function act(input: {
  index: number;
  before: string;
  after: string;
  url: string;
  role?: string;
  name?: string;
  do?: TraceAct["do"];
  value?: string;
}): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: `e${input.index}`,
    do: input.do ?? "click",
    locator: { role: input.role ?? "button", name: input.name ?? "Next", ordinal: 0 },
    ...(input.value !== undefined ? { value: input.value } : {}),
    doc: 1,
    v: input.index + 1,
    url: input.url,
    before_state: input.before,
    after_state: input.after,
    effects: [],
    delta: { navigation: false, entries: [] },
  };
}

function storeTrace(intent: string): Trace {
  const entries = [
    act({
      index: 0,
      before: "catalog",
      after: "catalog",
      url: "/",
      role: "textbox",
      name: "Search products",
      do: "fill",
      value: "tee",
    }),
    act({ index: 1, before: "catalog", after: "results", url: "/search" }),
    act({ index: 2, before: "results", after: "product", url: "/p/p_101" }),
    act({
      index: 3,
      before: "product",
      after: "product",
      url: "/p/p_101",
      role: "combobox",
      name: "Size / color",
      do: "select",
      value: "v_101_m_blue",
    }),
    act({
      index: 4,
      before: "product",
      after: "product",
      url: "/p/p_101",
      role: "spinbutton",
      name: "Quantity",
      do: "fill",
      value: "1",
    }),
    act({ index: 5, before: "product", after: "cart", url: "/cart" }),
    act({ index: 6, before: "cart", after: "checkout", url: "/checkout" }),
    act({
      index: 7,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "Full name",
      do: "fill",
      value: "Ada Lovelace",
    }),
    act({
      index: 8,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "Email",
      do: "fill",
      value: "ada@example.com",
    }),
    act({
      index: 9,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "Address",
      do: "fill",
      value: "1 Analytical Way",
    }),
    act({
      index: 10,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "City",
      do: "fill",
      value: "London",
    }),
    act({
      index: 11,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "Postal code",
      do: "fill",
      value: "N1 1AA",
    }),
    act({
      index: 12,
      before: "checkout",
      after: "checkout",
      url: "/checkout",
      role: "textbox",
      name: "Card number",
      do: "fill",
      value: "4242424242424242",
    }),
    act({ index: 13, before: "checkout", after: "order", url: "/orders/ord_1001" }),
  ];

  return {
    scope_id: "scope",
    sid: "sid",
    intent,
    effect: "write",
    started_at: new Date(0).toISOString(),
    ended_at: new Date(1).toISOString(),
    entries,
  };
}

describe("exportSkill", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "portolan-skill-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("mines a recipe and writes a skill that validates", async () => {
    const storeMap = map();
    const result = await exportSkill({
      map: storeMap,
      traces: [
        storeTrace("Buy one Everyday Tee in M / Blue."),
        storeTrace("Buy one Merino Socks in S / Charcoal."),
      ],
      gotchas: ["The variant select is required before adding to the cart."],
      outDir: dir,
    });

    expect(result.name).toBe("portolan-store");
    expect(result.recipes[0]).toMatchObject({
      steps: ["search", "get_product", "add_to_cart", "open_checkout", "checkout"],
      count: 2,
    });

    const validation = await validateSkillDir(result.dir, {
      name: "portolan-store",
      mapVersion: 1,
      map: storeMap,
    });
    expect(validation).toEqual({ ok: true, issues: [] });

    const raw = await readFile(result.skillPath, "utf8");
    expect(raw).toContain("map_version: 1");
    expect(raw).toContain("## Recipes");
    expect(raw).toContain("The variant select is required");
    expect(raw).toContain("search");

    const references = await readFile(result.referencesPath, "utf8");
    expect(references).toContain("### Params");
    expect(references).toContain("product_id");
  });

  it("rejects a skill whose map version does not match", async () => {
    const storeMap = map();
    const result = await exportSkill({ map: storeMap, outDir: dir });
    const raw = await readFile(result.skillPath, "utf8");

    const validation = validateSkill(raw.replace("map_version: 1", "map_version: 2"), {
      name: "portolan-store",
      mapVersion: 1,
      map: storeMap,
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toContain("map_version must be 1");
  });

  it("rejects a skill with the wrong name", async () => {
    const storeMap = map();
    const result = await exportSkill({ map: storeMap, outDir: dir });
    const raw = await readFile(result.skillPath, "utf8");

    const validation = validateSkill(raw, {
      name: "portolan-other",
      mapVersion: 1,
      map: storeMap,
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toContain('name must be "portolan-other"');
  });

  it("returns no recipe for a single-op trace", () => {
    const storeMap = map();
    const single: Trace = {
      ...storeTrace("Look at the catalog."),
      entries: [act({ index: 0, before: "catalog", after: "results", url: "/search" })],
    };

    expect(mineRecipes([single], storeMap)).toEqual([]);
  });
});
