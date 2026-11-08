import { describe, expect, it } from "vitest";

import { PROTOCOL_NAME, PROTOCOL_VERSION } from "./index.js";

describe("protocol", () => {
  it("names the wire protocol", () => {
    expect(PROTOCOL_NAME).toBe("portolan");
  });

  it("exposes a semver-shaped protocol version", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
