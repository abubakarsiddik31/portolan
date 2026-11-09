import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionStore } from "./store.js";

const dirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-ledger-"));
  dirs.push(dir);
  return join(dir, "sessions.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("write ledger", () => {
  it("stores and reads a completed record with its result", () => {
    const store = new SessionStore();
    const ledger = store.writeLedger();

    ledger.put({
      key: "k",
      site: "store",
      op: "checkout",
      status: "done",
      result: { order_id: "o1" },
      updatedAt: "2026-11-09T00:00:00.000Z",
    });

    expect(ledger.get("k")).toEqual({
      key: "k",
      site: "store",
      op: "checkout",
      status: "done",
      result: { order_id: "o1" },
      updatedAt: "2026-11-09T00:00:00.000Z",
    });

    store.closeDatabase();
  });

  it("updates a record in place", () => {
    const store = new SessionStore();
    const ledger = store.writeLedger();

    ledger.put({ key: "k", site: "store", op: "pay", status: "pending", updatedAt: "a" });
    ledger.put({
      key: "k",
      site: "store",
      op: "pay",
      status: "done",
      result: { ok: true },
      updatedAt: "b",
    });

    expect(ledger.get("k")).toMatchObject({ status: "done", result: { ok: true } });
    store.closeDatabase();
  });

  it("survives a reopen", () => {
    const path = tempPath();
    const first = new SessionStore(path);
    first.writeLedger().put({
      key: "k",
      site: "store",
      op: "pay",
      status: "done",
      result: { order_id: "o1" },
      updatedAt: "a",
    });
    first.closeDatabase();

    const second = new SessionStore(path);
    expect(second.writeLedger().get("k")).toMatchObject({ status: "done" });
    second.closeDatabase();
  });

  it("settles a pending write to unknown, and leaves done alone", () => {
    const store = new SessionStore();
    const ledger = store.writeLedger();

    ledger.put({ key: "p", site: "store", op: "pay", status: "pending", updatedAt: "a" });
    ledger.put({ key: "d", site: "store", op: "pay", status: "done", updatedAt: "a" });

    expect(store.settlePendingWrites(Date.parse("2026-11-09T00:00:00Z"))).toBe(1);
    expect(ledger.get("p")).toMatchObject({
      status: "unknown",
      updatedAt: "2026-11-09T00:00:00.000Z",
    });
    expect(ledger.get("d")?.status).toBe("done");

    store.closeDatabase();
  });
});
