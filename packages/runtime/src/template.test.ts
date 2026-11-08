import { describe, expect, it } from "vitest";

import { fillRoute, fillTemplate } from "./template.js";

describe("fillTemplate", () => {
  it("substitutes params", () => {
    expect(fillTemplate("/q/{query}/{page}", { query: "tee", page: 2 })).toBe("/q/tee/2");
  });

  it("returns undefined when a param is missing", () => {
    expect(fillTemplate("/q/{query}", {})).toBeUndefined();
  });

  it("leaves an empty template alone", () => {
    expect(fillTemplate("/fixed", {})).toBe("/fixed");
  });
});

describe("fillRoute", () => {
  it("URL-encodes each value", () => {
    expect(fillRoute("/p/{id}", { id: "a b/c" })).toBe("/p/a%20b%2Fc");
  });

  it("returns undefined when a param is missing", () => {
    expect(fillRoute("/p/{id}", {})).toBeUndefined();
  });
});
