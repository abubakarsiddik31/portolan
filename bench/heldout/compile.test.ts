import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMap } from "@abubakarsiddiik/protocol";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const FREEZE = JSON.parse(readFileSync(join(ROOT, "bench/results/freeze.json"), "utf8")) as {
  commit: string;
  model: string;
  created_at: string;
  maps: {
    library: { version: number; path: string; ops: string[] };
    support: { version: number; path: string; ops: string[] };
  };
};

describe("held-out compile", () => {
  it("records a freeze commit and the model", () => {
    expect(FREEZE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(FREEZE.model).toBe("scripted");
    expect(FREEZE.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("publishes a compiled library map", () => {
    const map = parseMap(readFileSync(join(ROOT, FREEZE.maps.library.path), "utf8"));

    expect(map.site).toBe("library");
    expect(map.version).toBe(FREEZE.maps.library.version);
    expect(map.ops.map((op) => op.name)).toEqual(FREEZE.maps.library.ops);
    expect(map.ops.find((op) => op.name === "search")?.impls[0]?.tier).toBe("url");
    expect(map.ops.find((op) => op.name === "get_book")?.impls[0]?.tier).toBe("url");
    expect(map.ops.find((op) => op.name === "borrow")?.impls[0]?.tier).toBe("ui");
  });

  it("publishes a compiled support map with an http write and its outcome check", () => {
    const map = parseMap(readFileSync(join(ROOT, FREEZE.maps.support.path), "utf8"));

    expect(map.site).toBe("support");
    expect(map.version).toBe(FREEZE.maps.support.version);
    expect(map.ops.map((op) => op.name)).toEqual(FREEZE.maps.support.ops);

    const create = map.ops.find((op) => op.name === "create_ticket");
    expect(create?.impls[0]?.tier).toBe("http");
    expect(create?.outcome_check).toBe("list_tickets");
  });

  it("keeps the seed maps valid", () => {
    for (const site of ["library", "support"]) {
      const seed = parseMap(readFileSync(join(ROOT, "maps/heldout", site, "v1.json"), "utf8"));
      expect(seed.version).toBe(1);
      expect(seed.ops.length).toBeGreaterThan(0);
    }
  });
});
