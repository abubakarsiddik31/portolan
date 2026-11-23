import { describe, expect, it } from "vitest";

import { isIdLike } from "./id-like.js";

describe("isIdLike", () => {
  it("takes numbers, uuids, hex, and prefixed ids for ids", () => {
    for (const id of [
      "42",
      "3f2b8c1e-9a4d-4e7a-8b1c-0d5e6f7a8b9c",
      "deadbeef01",
      "p_101",
      "ord_1",
      "usr_9f3a",
      "v_101_m_blue",
    ]) {
      expect(isIdLike(id), id).toBe(true);
    }
  });

  it("leaves page names alone", () => {
    for (const name of ["orders", "admin", "getting_started", "sign-in", "v2", "web3", "p"]) {
      expect(isIdLike(name), name).toBe(false);
    }
  });
});
