import { describe, expect, it } from "vitest";
import type { Trace, TraceAct } from "./fallback.js";
import {
  isCredentialValue,
  isSensitiveKey,
  redactRecord,
  redactText,
  redactTrace,
} from "./redact.js";

function act(overrides: Partial<TraceAct> = {}): TraceAct {
  return {
    kind: "act",
    at: "2026-01-01T00:00:00.000Z",
    ref: "e1",
    do: "fill",
    value: "hunter2",
    locator: { role: "textbox", name: "Password", ordinal: 0 },
    doc: 1,
    v: 1,
    url: "https://x/login",
    effects: [],
    delta: { navigation: false, entries: [] },
    ...overrides,
  };
}

function trace(entries: Trace["entries"]): Trace {
  return {
    scope_id: "s",
    sid: "sid",
    intent: "sign in",
    effect: "write",
    started_at: "2026-01-01T00:00:00.000Z",
    entries,
  };
}

describe("isSensitiveKey", () => {
  it("matches credential names, not ordinary fields", () => {
    expect(isSensitiveKey("Password")).toBe(true);
    expect(isSensitiveKey("Card number")).toBe(true);
    expect(isSensitiveKey("API key")).toBe(true);
    expect(isSensitiveKey("authorization")).toBe(true);
    expect(isSensitiveKey("Full name")).toBe(false);
    expect(isSensitiveKey("Email")).toBe(false);
    expect(isSensitiveKey(undefined)).toBe(false);
  });
});

describe("redactRecord", () => {
  it("redacts nested credential keys and leaves the rest", () => {
    expect(
      redactRecord({
        email: "ada@example.com",
        password: "hunter2",
        nested: { token: "abc", note: "keep" },
        items: [{ secret: "s" }],
      }),
    ).toEqual({
      email: "ada@example.com",
      password: "[redacted]",
      nested: { token: "[redacted]", note: "keep" },
      items: [{ secret: "[redacted]" }],
    });
  });
});

describe("credential values", () => {
  it("redacts common key formats even under an innocent field name", () => {
    const values = [
      "sk-abcdefghijklmnopqrstuvwxyz012345",
      "sk-ant-abcdefghijklmnopqrstuvwxyz012345",
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
      "github_pat_abcdefghijklmnopqrstuvwxyz012345",
      "AKIAIOSFODNN7EXAMPLE",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "sk_live_abcdefghijklmnopqrstuvwxyz",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature123",
      "123-45-6789",
    ];

    for (const value of values) {
      expect(isCredentialValue(value), value).toBe(true);
      expect(redactText(`prefix ${value} suffix`)).toContain("[redacted]");
      expect(redactText(`prefix ${value} suffix`)).not.toContain(value);
    }
  });

  it("redacts a Luhn-valid card number, with or without separators", () => {
    expect(redactText("4242 4242 4242 4242")).toBe("[redacted]");
    expect(redactText("4242-4242-4242-4242")).toBe("[redacted]");
    expect(redactText("4242424242424242")).toBe("[redacted]");
  });

  it("leaves ordinary text and invalid numbers alone", () => {
    expect(redactText("order 1234567890123 shipped")).toBe("order 1234567890123 shipped");
    expect(redactText("4242 4242 4242 4241")).toBe("4242 4242 4242 4241");
    expect(redactText("version 1.2.3")).toBe("version 1.2.3");
  });

  it("redacts a value inside a record and inside a read", () => {
    expect(redactRecord({ note: "key sk-abcdefghijklmnopqrstuvwxyz012345" })).toEqual({
      note: "key [redacted]",
    });

    const redacted = redactTrace(
      trace([{ kind: "read", at: "t", text: "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig" }]),
    );
    expect(redacted.entries[0]).toMatchObject({ text: "token: [redacted]" });
  });
});

describe("redactTrace", () => {
  it("redacts a credential fill, its read, and network bodies", () => {
    const redacted = redactTrace(
      trace([
        act({
          effects: [
            {
              kind: "network",
              method: "POST",
              url: "https://x/login",
              status: 200,
              request_body: { email: "ada@example.com", password: "hunter2" },
              response_body: { token: "session-token" },
            },
          ],
        }),
        {
          kind: "read",
          at: "2026-01-01T00:00:01.000Z",
          ref: "e1",
          text: "hunter2",
        },
      ]),
    );

    const actEntry = redacted.entries[0];
    if (actEntry?.kind !== "act") throw new Error("expected an act");
    expect(actEntry.value).toBe("[redacted]");

    const effect = actEntry.effects[0];
    expect(effect).toMatchObject({
      kind: "network",
      request_body: { email: "ada@example.com", password: "[redacted]" },
      response_body: { token: "[redacted]" },
    });

    const readEntry = redacted.entries[1];
    if (readEntry?.kind !== "read") throw new Error("expected a read");
    expect(readEntry.text).toBe("[redacted]");
  });

  it("leaves an ordinary field alone", () => {
    const redacted = redactTrace(
      trace([act({ locator: { role: "textbox", name: "Full name", ordinal: 0 }, value: "Ada" })]),
    );

    expect(redacted.entries[0]).toMatchObject({ value: "Ada" });
  });
});
