import { describe, expect, it } from "vitest";
import type { Trace, TraceAct } from "./fallback.js";
import { isSensitiveKey, redactRecord, redactTrace } from "./redact.js";

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
