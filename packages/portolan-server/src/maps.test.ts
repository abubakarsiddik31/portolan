import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeContext, MapStore, renderMap } from "./maps.js";

const MAPS = join(import.meta.dirname, "../../../maps");

describe("map store", () => {
  const maps = new MapStore(MAPS);

  it("lists the fixture sites with their latest version", () => {
    expect(maps.list().map((site) => site.site)).toEqual(["portal", "store", "wizard"]);
  });

  it("loads a site map", () => {
    const map = maps.get("store");

    expect(map?.version).toBe(1);
    expect(map?.ops.map((op) => op.name)).toContain("checkout");
  });

  it("returns undefined for an unknown site", () => {
    expect(maps.get("nope")).toBeUndefined();
    expect(maps.latestVersion("nope")).toBeUndefined();
    expect(maps.getVersion("store", 99)).toBeUndefined();
  });

  it("refuses a site name that escapes the maps directory", () => {
    expect(maps.get("../maps/store")).toBeUndefined();
    expect(maps.get("..")).toBeUndefined();
    expect(maps.latestVersion("../maps/store")).toBeUndefined();
    expect(maps.getVersion("../maps/store", 1)).toBeUndefined();
  });

  it("renders a compact map", () => {
    const map = maps.get("store");
    if (map === undefined) throw new Error("the store map is missing");

    const text = renderMap(map);

    expect(text).toContain("store · map v1");
    expect(text).toContain("checkout(");
    expect(text).toContain("[irreversible]");
  });

  it("shows where an op is and what it did, so alike names can be told apart", () => {
    const map = maps.get("store");
    if (map === undefined) throw new Error("the store map is missing");

    const op = map.ops[0];
    if (op === undefined) throw new Error("the store map has no ops");
    op.context = {
      page: "API keys",
      section: 'region "Danger zone"',
      subject: "ci-prod",
      observed: ["DELETE /api/keys/{id} -> 204"],
    };

    expect(renderMap(map)).toContain(
      'where: API keys > region "Danger zone" | on: ci-prod | effects: DELETE /api/keys/{id} -> 204',
    );
    expect(describeContext(undefined)).toBeUndefined();
  });
});
