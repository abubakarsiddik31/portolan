import { describe, expect, it } from "vitest";

import { assertBindAllowed, isLoopbackHost } from "./host.js";

describe("bind policy", () => {
  it("allows loopback hosts", () => {
    for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => assertBindAllowed(host)).not.toThrow();
    }
  });

  it("refuses a public bind without a token or an opt-in", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(() => assertBindAllowed("0.0.0.0")).toThrow(/PORTOLAN_AUTH_TOKEN/);
    expect(() => assertBindAllowed("example.test")).toThrow(/refusing/);
  });

  it("allows a public bind with a token or the explicit opt-in", () => {
    expect(() => assertBindAllowed("0.0.0.0", { authToken: "secret" })).not.toThrow();
    expect(() => assertBindAllowed("0.0.0.0", { allowRemote: true })).not.toThrow();
    expect(() => assertBindAllowed("0.0.0.0", { authToken: "" })).toThrow();
  });
});
