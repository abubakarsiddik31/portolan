import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { SiteMap } from "../index.js";
import { assertPortable, parseMap } from "../index.js";

const MAPS = join(import.meta.dirname, "../../../../maps");
const FILES = ["store/v1.json", "wizard/v1.json", "portal/v1.json"];

function read(file: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, file), "utf8"));
}

describe("fixture maps", () => {
  for (const file of FILES) {
    it(`loads and passes the portable lint: ${file}`, () => {
      const map = read(file);

      expect(map.ops.length).toBeGreaterThan(0);
      expect(assertPortable(map)).toEqual([]);
    });
  }

  it("declares every store op", () => {
    expect(read("store/v1.json").ops.map((op) => op.name)).toEqual([
      "search",
      "get_product",
      "add_to_cart",
      "view_cart",
      "open_checkout",
      "checkout",
    ]);
  });

  it("declares every portal op and its auth entry", () => {
    const map = read("portal/v1.json");

    expect(map.ops.map((op) => op.name)).toEqual([
      "login",
      "filter_invoices",
      "paginate",
      "export_csv",
    ]);
    expect(map.auth).toEqual({ state: "invoices", login_op: "login" });
  });

  it("declares the wizard flow", () => {
    expect(read("wizard/v1.json").ops.map((op) => op.name)).toEqual(["submit_application"]);
  });

  it("keeps every irreversible op behind confirm", () => {
    for (const file of FILES) {
      for (const op of read(file).ops) {
        if (op.effect === "irreversible") {
          expect(op.confirm).toBe(true);
        }
      }
    }
  });

  it("gives every write op a post-check", () => {
    for (const file of FILES) {
      for (const op of read(file).ops) {
        if (op.effect !== "read") {
          expect(op.post.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
