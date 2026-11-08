import type { OpDef, SiteMap } from "@portolan/protocol";

export type WriteOutcome = "done" | "not_done" | "unknown";

export type WriteCheck = () => Promise<{
  outcome: WriteOutcome;
  result?: unknown;
}>;

export type WriteFailureCode =
  | "invalid_params"
  | "precondition_failed"
  | "needs_confirmation"
  | "op_broken"
  | "unknown_outcome";

export type WriteExecution =
  | { ok: true; result: unknown }
  | {
      ok: false;
      code: WriteFailureCode;
      message: string;
      details?: Record<string, unknown>;
    };

export type WriteRecord = {
  key: string;
  site: string;
  op: string;
  status: "pending" | "done" | "not_done" | "unknown";
  result?: unknown;
  updatedAt: string;
};

export interface WriteLedger {
  get(key: string): WriteRecord | undefined;
  put(record: WriteRecord): void;
}

export class MemoryWriteLedger implements WriteLedger {
  private readonly records = new Map<string, WriteRecord>();

  get(key: string): WriteRecord | undefined {
    return this.records.get(key);
  }

  put(record: WriteRecord): void {
    this.records.set(record.key, record);
  }
}

export type WriteSafetyInput = {
  map: SiteMap;
  op: OpDef;
  confirm?: boolean;
  idempotencyKey?: string;
  execute: () => Promise<WriteExecution>;
  /** Runs the op's `outcome_check` read op. */
  check?: WriteCheck;
  ledger: WriteLedger;
  now?: () => string;
};

export type WriteSafetyResult =
  | { ok: true; result: unknown; replayed: boolean }
  | {
      ok: false;
      code: WriteFailureCode;
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * The write path.
 *
 * - An irreversible op requires `confirm: true`.
 * - A completed idempotency key returns the stored result instead of running.
 * - A pending key is reconciled with `outcome_check` before it is retried.
 * - A failure after input was dispatched is never retried blindly: the check
 *   decides `done`, `not_done`, or `unknown_outcome`.
 */
export async function runWrite(input: WriteSafetyInput): Promise<WriteSafetyResult> {
  const { map, op, confirm, idempotencyKey, execute, check, ledger } = input;
  const now = input.now ?? (() => new Date().toISOString());

  if (op.effect === "irreversible" && confirm !== true) {
    return {
      ok: false,
      code: "needs_confirmation",
      message: `"${op.name}" is irreversible; pass confirm: true`,
    };
  }

  if (idempotencyKey !== undefined) {
    const existing = ledger.get(idempotencyKey);

    // A key identifies one write. Reusing it for another site or op would
    // replay a result the caller never asked for, so refuse the collision
    // instead of returning the wrong answer.
    if (existing !== undefined && (existing.site !== map.site || existing.op !== op.name)) {
      return {
        ok: false,
        code: "invalid_params",
        message: `idempotency key "${idempotencyKey}" was used for ${existing.site}.${existing.op}`,
        details: {
          idempotency_key_reused: true,
          site: existing.site,
          op: existing.op,
        },
      };
    }

    if (existing?.status === "done") {
      return { ok: true, result: existing.result, replayed: true };
    }

    if (existing?.status === "unknown") {
      return {
        ok: false,
        code: "unknown_outcome",
        message: "a previous attempt has an unknown outcome; do not retry",
      };
    }

    if (existing?.status === "pending") {
      if (check === undefined) {
        return {
          ok: false,
          code: "unknown_outcome",
          message: "a previous attempt is pending and there is no outcome_check; do not retry",
        };
      }

      const outcome = await check();

      if (outcome.outcome === "done") {
        ledger.put({
          key: idempotencyKey,
          site: map.site,
          op: op.name,
          status: "done",
          result: outcome.result,
          updatedAt: now(),
        });
        return { ok: true, result: outcome.result, replayed: true };
      }

      if (outcome.outcome === "unknown") {
        ledger.put({
          key: idempotencyKey,
          site: map.site,
          op: op.name,
          status: "unknown",
          updatedAt: now(),
        });
        return {
          ok: false,
          code: "unknown_outcome",
          message: "a previous attempt has an unknown outcome; do not retry",
        };
      }
    }

    ledger.put({
      key: idempotencyKey,
      site: map.site,
      op: op.name,
      status: "pending",
      updatedAt: now(),
    });
  }

  let result: WriteExecution;

  try {
    result = await execute();
  } catch (error) {
    result = {
      ok: false,
      code: "op_broken",
      message: error instanceof Error ? error.message : String(error),
      details: { thrown: true },
    };
  }

  if (result.ok) {
    if (idempotencyKey !== undefined) {
      ledger.put({
        key: idempotencyKey,
        site: map.site,
        op: op.name,
        status: "done",
        result: result.result,
        updatedAt: now(),
      });
    }
    return { ok: true, result: result.result, replayed: false };
  }

  if (isBeforeDispatch(result)) {
    if (idempotencyKey !== undefined) {
      ledger.put({
        key: idempotencyKey,
        site: map.site,
        op: op.name,
        status: "not_done",
        updatedAt: now(),
      });
    }
    return {
      ok: false,
      code: result.code,
      message: result.message,
      ...(result.details !== undefined ? { details: result.details } : {}),
    };
  }

  if (check !== undefined) {
    const outcome = await check();

    if (outcome.outcome === "done") {
      if (idempotencyKey !== undefined) {
        ledger.put({
          key: idempotencyKey,
          site: map.site,
          op: op.name,
          status: "done",
          result: outcome.result,
          updatedAt: now(),
        });
      }
      return { ok: true, result: outcome.result, replayed: true };
    }

    if (outcome.outcome === "not_done") {
      if (idempotencyKey !== undefined) {
        ledger.put({
          key: idempotencyKey,
          site: map.site,
          op: op.name,
          status: "not_done",
          updatedAt: now(),
        });
      }
      return {
        ok: false,
        code: result.code,
        message: result.message,
        details: { ...result.details, outcome: "not_done" },
      };
    }
  }

  if (idempotencyKey !== undefined) {
    ledger.put({
      key: idempotencyKey,
      site: map.site,
      op: op.name,
      status: "unknown",
      updatedAt: now(),
    });
  }

  return {
    ok: false,
    code: "unknown_outcome",
    message: "the write may have happened; do not retry",
    details: { ...result.details, outcome: "unknown" },
  };
}

/**
 * A failure is "before dispatch" only when it proves no input reached the
 * page: bad params, a wrong state, a covered target, a stale ref, or an HTTP
 * rejection. Everything else may have changed the server and is reconciled.
 */
function isBeforeDispatch(result: Extract<WriteExecution, { ok: false }>): boolean {
  if (
    result.code === "invalid_params" ||
    result.code === "precondition_failed" ||
    result.code === "needs_confirmation"
  ) {
    return true;
  }

  if (result.code !== "op_broken") return false;

  const details = result.details;
  if (details === undefined) return false;

  return (
    details.blocker_ref !== undefined ||
    details.new_ref !== undefined ||
    details.status !== undefined
  );
}
