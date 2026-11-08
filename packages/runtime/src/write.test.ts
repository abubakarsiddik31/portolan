import type { OpDef, SiteMap } from "@portolan/protocol";
import { describe, expect, it, vi } from "vitest";

import { MemoryWriteLedger, runWrite, type WriteExecution } from "./write.js";

const MAP: SiteMap = {
  site: "test",
  origins: ["http://x"],
  version: 1,
  states: [],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-08T00:00:00Z",
};

function opDef(overrides: Partial<OpDef>): OpDef {
  return {
    name: "place",
    version: 1,
    summary: "place",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: [],
    to: [],
    post: [],
    effect: "write",
    impls: [
      {
        tier: "ui",
        steps: [{ do: "click", target: { role: "button", name: "Go" } }],
        extract: { kind: "none" },
      },
    ],
    status: "verified",
    ...overrides,
  };
}

const WRITE = opDef({ effect: "write" });
const IRREVERSIBLE = opDef({ effect: "irreversible", confirm: true });

describe("confirmation", () => {
  it("refuses an irreversible op without confirm", async () => {
    const execute = vi.fn(async (): Promise<WriteExecution> => ({ ok: true, result: {} }));

    const result = await runWrite({
      map: MAP,
      op: IRREVERSIBLE,
      execute,
      ledger: new MemoryWriteLedger(),
    });

    expect(result).toMatchObject({ ok: false, code: "needs_confirmation" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs an irreversible op with confirm", async () => {
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({ ok: true, result: { order_id: "ord_1" } }),
    );

    const result = await runWrite({
      map: MAP,
      op: IRREVERSIBLE,
      confirm: true,
      execute,
      ledger: new MemoryWriteLedger(),
    });

    expect(result).toEqual({
      ok: true,
      result: { order_id: "ord_1" },
      replayed: false,
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("idempotency", () => {
  it("replays a completed key without executing", async () => {
    const ledger = new MemoryWriteLedger();
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({ ok: true, result: { order_id: "ord_1" } }),
    );

    const first = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      ledger,
    });
    const second = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      ledger,
    });

    expect(first).toEqual({ ok: true, result: { order_id: "ord_1" }, replayed: false });
    expect(second).toEqual({ ok: true, result: { order_id: "ord_1" }, replayed: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reconciles a pending key that is already done", async () => {
    const ledger = new MemoryWriteLedger();
    ledger.put({
      key: "k",
      site: "test",
      op: "place",
      status: "pending",
      updatedAt: "",
    });
    const execute = vi.fn(async (): Promise<WriteExecution> => ({ ok: true, result: {} }));
    const check = vi.fn(async () => ({
      outcome: "done" as const,
      result: { order_id: "ord_9" },
    }));

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });

    expect(result).toEqual({ ok: true, result: { order_id: "ord_9" }, replayed: true });
    expect(execute).not.toHaveBeenCalled();
    expect(ledger.get("k")?.status).toBe("done");
  });

  it("refuses to retry a pending key without an outcome_check", async () => {
    const ledger = new MemoryWriteLedger();
    ledger.put({
      key: "k",
      site: "test",
      op: "place",
      status: "pending",
      updatedAt: "",
    });
    const execute = vi.fn(async (): Promise<WriteExecution> => ({ ok: true, result: {} }));

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      ledger,
    });

    expect(result).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a pending key that is not done", async () => {
    const ledger = new MemoryWriteLedger();
    ledger.put({
      key: "k",
      site: "test",
      op: "place",
      status: "pending",
      updatedAt: "",
    });
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({ ok: true, result: { order_id: "ord_2" } }),
    );
    const check = vi.fn(async () => ({ outcome: "not_done" as const }));

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });

    expect(result).toEqual({ ok: true, result: { order_id: "ord_2" }, replayed: false });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("failures", () => {
  it("marks a before-dispatch failure as not_done", async () => {
    const ledger = new MemoryWriteLedger();
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({
        ok: false,
        code: "invalid_params",
        message: "bad params",
      }),
    );

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      ledger,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_params" });
    expect(ledger.get("k")?.status).toBe("not_done");
  });

  it("reconciles an after-dispatch failure to done", async () => {
    const ledger = new MemoryWriteLedger();
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({
        ok: false,
        code: "op_broken",
        message: "step 2 failed",
        details: { locator: { role: "button" } },
      }),
    );
    const check = vi.fn(async () => ({
      outcome: "done" as const,
      result: { order_id: "ord_3" },
    }));

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });

    expect(result).toEqual({ ok: true, result: { order_id: "ord_3" }, replayed: true });
    expect(ledger.get("k")?.status).toBe("done");
  });

  it("reports not_done when the check proves the write did not happen", async () => {
    const ledger = new MemoryWriteLedger();
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({
        ok: false,
        code: "op_broken",
        message: "step 2 failed",
      }),
    );
    const check = vi.fn(async () => ({ outcome: "not_done" as const }));

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "op_broken",
      details: { outcome: "not_done" },
    });
    expect(ledger.get("k")?.status).toBe("not_done");
  });

  it("reports unknown_outcome and never retries", async () => {
    const ledger = new MemoryWriteLedger();
    const execute = vi.fn(
      async (): Promise<WriteExecution> => ({
        ok: false,
        code: "op_broken",
        message: "timeout",
      }),
    );
    const check = vi.fn(async () => ({ outcome: "unknown" as const }));

    const first = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });
    expect(first).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(ledger.get("k")?.status).toBe("unknown");

    const second = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger,
    });
    expect(second).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("treats a thrown error as after dispatch", async () => {
    const check = vi.fn(async () => ({ outcome: "unknown" as const }));
    const execute = vi.fn(async (): Promise<WriteExecution> => {
      throw new Error("connection reset");
    });

    const result = await runWrite({
      map: MAP,
      op: WRITE,
      idempotencyKey: "k",
      execute,
      check,
      ledger: new MemoryWriteLedger(),
    });

    expect(result).toMatchObject({ ok: false, code: "unknown_outcome" });
    expect(check).toHaveBeenCalledOnce();
  });
});
