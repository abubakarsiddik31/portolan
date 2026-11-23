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
    expect(() => resolveValues("$" + "{env.QA_NOPE}", context)).toThrow(/is not set/);
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

  it("leaves a name the author chose alone, and redacts the text around it", () => {
    const id = "auth/wrong-password-shows-error";
    expect(redactText(`case ${id} failed with password=hunter2`, context.redact, [], [id])).toBe(
      `case ${id} failed with [redacted]=hunter2`,
    );
    expect(redactValues({ case_id: id, detail: "token abc" }, context.redact, [], [id])).toEqual({
      case_id: id,
      detail: "[redacted] abc",
    });
    expect(redactText(id, context.redact)).toBe("auth/wrong-[redacted]-shows-error");
  });

  it("redacts tokens embedded in text", () => {
    expect(redactText("Authorization: Bearer abc password=hunter2", context.redact)).toBe(
      "[redacted]: Bearer abc [redacted]=hunter2",
    );
  });
});

describe("secret handling", () => {
  const ref = (name: string) => `$` + `{env.${name}}`;

  it("resolves only QA_* variables", () => {
    const env = { QA_TOKEN: "tok_live_123", AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI" };
    expect(() => resolveValues(ref("AWS_SECRET_ACCESS_KEY"), { ...context, env })).toThrow(
      /only reference QA_\* variables/,
    );
    expect(() => resolveValues(ref("HOME"), { ...context, env })).toThrow(/not readable/);
  });

  it("refuses an env placeholder where it would leave the machine", () => {
    const secrets = new Set<string>();
    const plain = { ...context, allowEnv: false, secrets };
    expect(() => resolveValues(ref("QA_TOKEN"), plain)).toThrow(/only allowed in/);
    expect(secrets.size).toBe(0);
  });

  it("records each resolved value and calls the origin guard first", () => {
    const secrets = new Set<string>();
    const calls: string[] = [];
    resolveValues(ref("QA_TOKEN"), {
      ...context,
      secrets,
      beforeEnv: () => calls.push("checked"),
    });
    expect([...secrets]).toEqual(["tok_live_123"]);
    expect(calls).toEqual(["checked"]);

    expect(() =>
      resolveValues(ref("QA_TOKEN"), {
        ...context,
        beforeEnv: () => {
          throw new Error("wrong origin");
        },
      }),
    ).toThrow(/wrong origin/);
  });

  it("scrubs a secret value in every spelling, not only by key name", () => {
    const secret = 'p@ss "w0rd"&1';
    const forms = [
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
      Buffer.from(secret).toString("base64"),
    ];

    for (const form of forms) {
      expect(redactText(`before ${form} after`, context.redact, [secret])).toBe(
        "before [redacted] after",
      );
    }
    expect(redactValues({ expected: secret, nested: [secret] }, [], [secret])).toEqual({
      expected: "[redacted]",
      nested: ["[redacted]"],
    });
  });

  it("scrubs a secret that contains a redact token whole", () => {
    expect(redactText("typed mypassword1 here", context.redact, ["mypassword1"])).toBe(
      "typed [redacted] here",
    );
  });

  it("leaves a value shorter than four characters alone", () => {
    expect(redactText("a bob b", [], ["bob"])).toBe("a bob b");
  });
});
