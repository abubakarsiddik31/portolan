import { describe, expect, it } from "vitest";

import { FallbackScopes } from "./fallback.js";

describe("FallbackScopes", () => {
  it("begins a write scope with the allowed verbs", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "finish checkout" });

    expect(scope.allowed).toEqual(["view", "act", "read"]);
    expect(scope.effect).toBe("write");
    expect(scopes.active("s1")?.id).toBe(scope.id);
  });

  it("does not block writes for a read scope", () => {
    const scopes = new FallbackScopes();
    scopes.begin({ sid: "s1", intent: "read invoices", effect: "read" });

    expect(scopes.active("s1")).toBeDefined();
    expect(scopes.blocksWrite("s1")).toBeUndefined();
  });

  it("blocks writes for a write scope", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "place order" });

    expect(scopes.blocksWrite("s1")?.id).toBe(scope.id);
  });

  it("closes a scope once and keeps the result", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "x" });

    expect(scopes.close(scope.id, { ok: true })?.result).toEqual({ ok: true });
    expect(scopes.close(scope.id)).toBeUndefined();
    expect(scopes.active("s1")).toBeUndefined();
  });

  it("expires a scope", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "x", ttlMs: 10, now: () => 0 });

    expect(scopes.active("s1", 5)?.id).toBe(scope.id);
    expect(scopes.active("s1", 10)).toBeUndefined();
  });

  it("records entries and stamps the end", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "x" });

    expect(scope.started_at).toBeTypeOf("string");
    expect(scope.ended_at).toBeUndefined();

    expect(
      scopes.record(scope.id, {
        kind: "read",
        at: new Date().toISOString(),
        text: "hello",
      }),
    ).toBe(true);

    const closed = scopes.close(scope.id);
    expect(closed?.trace).toHaveLength(1);
    expect(closed?.trace[0]).toMatchObject({ kind: "read", text: "hello" });
    expect(closed?.ended_at).toBeTypeOf("string");
  });

  it("refuses to record into a closed scope", () => {
    const scopes = new FallbackScopes();
    const scope = scopes.begin({ sid: "s1", intent: "x" });

    scopes.close(scope.id);

    expect(
      scopes.record(scope.id, {
        kind: "read",
        at: new Date().toISOString(),
        text: "late",
      }),
    ).toBe(false);
  });

  it("scopes are per session", () => {
    const scopes = new FallbackScopes();
    const first = scopes.begin({ sid: "s1", intent: "a" });
    const second = scopes.begin({ sid: "s2", intent: "b" });

    expect(scopes.active("s1")?.id).toBe(first.id);
    expect(scopes.active("s2")?.id).toBe(second.id);
  });
});
