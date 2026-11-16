import { describe, expect, it } from "vitest";

import { redactText, redactValues, resolveValues } from "./fixtures.js";

const context = {
  fixtures: { user: { email: "qa@example.test", password: "hunter2" } },
  env: { QA_TOKEN: "tok_live_123" },
  redact: ["password", "token", "authorization"],
};

describe("fixtures", () => {
  it("resolves fixture and environment placeholders", () => {
    expect(
      resolveValues(
        {
          email: "$" + "{fixture.user.email}",
          token: "$" + "{env.QA_TOKEN}",
          nested: ["$" + "{fixture.user.email}"],
        },
        context,
      ),
    ).toEqual({ email: "qa@example.test", token: "tok_live_123", nested: ["qa@example.test"] });
  });

  it("fails typed when a fixture or env var is missing", () => {
    expect(() => resolveValues("$" + "{fixture.user.missing}", context)).toThrow(/has no value/);
    expect(() => resolveValues("$" + "{env.NOPE}", context)).toThrow(/is not set/);
  });

  it("redacts secret-like keys and values", () => {
    expect(
      redactValues(
        { password: "hunter2", headers: { Authorization: "Bearer abc" }, note: "safe" },
        context.redact,
      ),
    ).toEqual({
      password: "[redacted]",
      headers: { Authorization: "[redacted]" },
      note: "safe",
    });
  });

  it("redacts tokens embedded in text", () => {
    expect(redactText("Authorization: Bearer abc password=hunter2", context.redact)).toBe(
      "[redacted]: Bearer abc [redacted]=hunter2",
    );
  });
});
