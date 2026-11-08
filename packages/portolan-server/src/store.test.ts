import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionStore } from "./store.js";

describe("session store", () => {
  const stores: SessionStore[] = [];
  const dirs: string[] = [];

  function open(path = ":memory:"): SessionStore {
    const store = new SessionStore(path);
    stores.push(store);
    return store;
  }

  afterEach(() => {
    for (const store of stores.splice(0)) {
      try {
        store.closeDatabase();
      } catch {
        // A test may have closed it already.
      }
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a session with a unique id", () => {
    const store = open();
    const first = store.create({ site: "store" });
    const second = store.create({ site: "store" });

    expect(first.sid).not.toBe(second.sid);
    expect(first.site).toBe("store");
    expect(store.get(first.sid)).toEqual(first);
  });

  it("keeps an unbound session unbound", () => {
    const store = open();
    const session = store.create();

    expect(session.site).toBeUndefined();
    expect(session.profile).toBeUndefined();
    expect(store.get(session.sid)).toEqual(session);
  });

  it("touches an open session", () => {
    const store = open();
    const session = store.create();

    expect(store.touch(session.sid)).toBe(true);
    expect(store.get(session.sid)?.last_used_at).toBeTypeOf("string");
  });

  it("closes a session once", () => {
    const store = open();
    const session = store.create();

    expect(store.close(session.sid)).toBe(true);
    expect(store.close(session.sid)).toBe(false);
    expect(store.get(session.sid)?.closed_at).toBeTypeOf("string");
    expect(store.touch(session.sid)).toBe(false);
  });

  it("does not list closed sessions", () => {
    const store = open();
    const openSession = store.create();
    const closed = store.create();
    store.close(closed.sid);

    expect(store.listOpen().map((session) => session.sid)).toEqual([openSession.sid]);
  });

  it("records and lists audit entries", () => {
    const store = open();
    const session = store.create({ site: "store" });

    store.recordAudit({
      id: "a1",
      sid: session.sid,
      site: "store",
      op: "checkout",
      effect: "irreversible",
      tier: "ui",
      params: { card: "4242" },
      idempotency_key: "order-1",
      before_state: "cart",
      after_state: "order",
      outcome: "done",
      requests: [{ method: "POST", url: "/api/checkout", status: 200 }],
      created_at: "2026-11-08T00:00:00Z",
    });

    expect(store.listAudit(session.sid)).toEqual([
      {
        id: "a1",
        sid: session.sid,
        site: "store",
        op: "checkout",
        effect: "irreversible",
        tier: "ui",
        params: { card: "[redacted]" },
        idempotency_key: "order-1",
        before_state: "cart",
        after_state: "order",
        outcome: "done",
        requests: [{ method: "POST", url: "/api/checkout", status: 200 }],
        created_at: "2026-11-08T00:00:00Z",
      },
    ]);
  });

  it("sweeps only sessions past the ttl", () => {
    vi.useFakeTimers();
    try {
      const store = open();
      vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
      const old = store.create({ site: "store" });

      vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
      const fresh = store.create({ site: "store" });

      expect(store.sweepExpired(60 * 60 * 1000)).toEqual([old.sid]);
      expect(store.get(old.sid)?.closed_at).toBe("2026-11-09T12:00:00.000Z");
      expect(store.get(fresh.sid)?.closed_at).toBeUndefined();
      expect(store.countOpen()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps nothing when every session is fresh", () => {
    const store = open();
    store.create();
    store.create();

    expect(store.sweepExpired(60 * 60 * 1000)).toEqual([]);
    expect(store.countOpen()).toBe(2);
  });

  it("counts open sessions, optionally per site", () => {
    const store = open();
    store.create({ site: "store" });
    store.create({ site: "store" });
    store.create({ site: "portal" });
    const closed = store.create({ site: "portal" });
    store.close(closed.sid);

    expect(store.countOpen()).toBe(3);
    expect(store.countOpen("store")).toBe(2);
    expect(store.countOpen("portal")).toBe(1);
    expect(store.countOpen("missing")).toBe(0);
  });

  it("closes every open session", () => {
    const store = open();
    const first = store.create();
    const second = store.create();
    const already = store.create();
    store.close(already.sid);

    expect(store.closeAllOpen()).toBe(2);
    expect(store.get(first.sid)?.closed_at).toBeTypeOf("string");
    expect(store.get(second.sid)?.closed_at).toBeTypeOf("string");
    expect(store.countOpen()).toBe(0);
  });

  it("survives a reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "portolan-"));
    dirs.push(dir);
    const path = join(dir, "sessions.db");

    const first = new SessionStore(path);
    const session = first.create({ site: "portal", profile: "analyst" });
    first.closeDatabase();

    const second = open(path);
    expect(second.get(session.sid)).toEqual(session);
  });
});
