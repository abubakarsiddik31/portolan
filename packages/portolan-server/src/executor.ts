import type {
  ErrorCode,
  OpDef,
  ResultEnvelope,
  SessionRecord,
  SiteMap,
} from "@abubakarsiddiik/protocol";
import {
  type HttpTransport,
  recognizeState,
  runHttpOp,
  runUiOp,
  runUrlOp,
} from "@abubakarsiddiik/runtime";
import type { Substrate } from "@abubakarsiddiik/substrate";

export type OpAudit = {
  tier?: "webmcp" | "url" | "http" | "ui";
  beforeState?: string;
  afterState?: string;
  requests?: Array<{ method: string; url: string; status?: number }>;
};

export type OpExecutorInput = {
  session: SessionRecord;
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
  confirm?: boolean;
  idempotencyKey?: string;
  /** The live substrate. Absent when the server has no browser factory. */
  substrate?: Substrate;
  /**
   * Opens the substrate only when an op needs a page, so an `http` op that a
   * saved session can serve never launches Chrome.
   */
  getSubstrate?: () => Promise<Substrate | undefined>;
  /** Override the map's first origin, e.g. a fixture on an ephemeral port. */
  baseUrl?: string;
  /** Optional: report how the op ran, for the audit log. */
  audit?: (info: OpAudit) => void;
};

/**
 * The op runtime behind the MCP surface.
 *
 * Kept as an injected function so the transport, session pinning, and
 * validation can be tested without a browser.
 */
export type OpExecutor = (input: OpExecutorInput) => Promise<ResultEnvelope>;

export type RuntimeExecutorOptions = {
  /** Default origin when the map has none. */
  baseUrl?: string;
  /**
   * A way to send an op's requests with no browser: a saved session in Node.
   * Return undefined when there is no session for the site.
   */
  pageless?: (input: { map: SiteMap; baseUrl: string }) => HttpTransport | undefined;
};

/**
 * Execute an op through the cheapest verified tier.
 *
 * The tiers are tried in the map's declared order. A read may start from any
 * state; a write must start in one of the op's `from` states, checked before
 * dispatch. `runWrite` in the MCP layer owns confirmation and idempotency, so
 * this function only runs the op.
 */
export function runtimeExecutor(options: RuntimeExecutorOptions = {}): OpExecutor {
  return async (input) => {
    const { map, op, params, baseUrl, audit } = input;

    const base = baseUrl ?? options.baseUrl ?? map.origins[0];
    if (base === undefined) {
      return broken(op, `site "${map.site}" has no origin`);
    }

    // An http op needs no page: a saved session carries the cookies and the
    // token. Try it first, and only open a browser when it cannot be served.
    const firstTier = op.impls.find((impl) => impl.tier !== "webmcp")?.tier;
    const transport = firstTier === "http" ? options.pageless?.({ map, baseUrl: base }) : undefined;
    let pagelessFailure: ResultEnvelope | undefined;

    if (transport !== undefined) {
      let result: Awaited<ReturnType<typeof runHttpOp>>;
      try {
        result = await runHttpOp({ map, op, params, substrate: transport, baseUrl: base });
      } catch (error) {
        result = {
          ok: false,
          code: "op_broken",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      if (result.ok) {
        audit?.({
          tier: "http",
          requests: [{ method: "HTTP", url: result.url, status: result.status }],
        });
        return { ok: true, result: result.result };
      }

      // A write that reached the site must not be sent again through a page;
      // the write guard decides what happens to it. Only a request that was
      // never sent (no token, blocked) may fall back.
      const sent = result.details?.status !== undefined;
      pagelessFailure = {
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          ...(result.details !== undefined ? { details: result.details } : {}),
        },
      };
      if (sent && op.effect !== "read") return pagelessFailure;
    }

    const substrate = input.substrate ?? (await input.getSubstrate?.());
    if (substrate === undefined) {
      return pagelessFailure ?? broken(op, "the server has no browser substrate");
    }

    const before = stateOf(map, await substrate.view());

    if (op.effect !== "read" && (before === undefined || !op.from.includes(before))) {
      return {
        ok: false,
        error: {
          code: "precondition_failed",
          message: `op "${op.name}" needs ${op.from.join(" or ")}, found ${before ?? "unknown"}`,
          ...(before !== undefined ? { details: { current_state: before } } : {}),
        },
      };
    }

    const tiers = [...new Set(op.impls.map((impl) => impl.tier))].filter(
      (tier) => tier !== "webmcp",
    );

    if (tiers.length === 0) {
      return broken(op, "no supported impl (webmcp is not implemented yet)");
    }

    let last: { code: ErrorCode; message: string; details?: Record<string, unknown> } | undefined;

    for (const tier of tiers) {
      if (tier === "url") {
        const result = await runUrlOp({ map, op, params, substrate, baseUrl: base });
        if (result.ok) {
          audit?.({
            tier: "url",
            ...(before !== undefined ? { beforeState: before } : {}),
            afterState: result.state,
            requests: [{ method: "GET", url: result.url }],
          });
          return { ok: true, result: result.result };
        }
        last = result;
        continue;
      }

      if (tier === "http") {
        const result = await runHttpOp({ map, op, params, substrate, baseUrl: base });
        if (result.ok) {
          audit?.({
            tier: "http",
            ...(before !== undefined ? { beforeState: before } : {}),
            requests: [{ method: "HTTP", url: result.url, status: result.status }],
          });
          return { ok: true, result: result.result };
        }
        last = result;
        continue;
      }

      if (tier === "ui") {
        const result = await runUiOp({ map, op, params, substrate });
        if (result.ok) {
          audit?.({
            tier: "ui",
            ...(before !== undefined ? { beforeState: before } : {}),
            afterState: result.state,
          });
          return { ok: true, result: result.result };
        }
        last = result;
      }
    }

    return last === undefined
      ? broken(op, "no impl ran")
      : {
          ok: false,
          error: {
            code: last.code,
            message: last.message,
            ...(last.details !== undefined ? { details: last.details } : {}),
          },
        };
  };
}

function broken(op: OpDef, message: string): ResultEnvelope {
  return {
    ok: false,
    error: {
      code: "op_broken",
      message: `op "${op.name}" reached the runtime, but ${message}`,
      details: { stage: "executor", op: op.name },
    },
  };
}

function stateOf(map: SiteMap, view: Awaited<ReturnType<Substrate["view"]>>): string | undefined {
  return recognizeState(map, view.snapshot)?.state.id;
}

/**
 * The executor used before a browser factory is configured.
 *
 * It reports exactly where the call stopped. Returning a fake success would
 * be worse than failing: a caller would believe an order was placed.
 */
export const notReadyExecutor: OpExecutor = async ({ op }) =>
  broken(op, "execution is not configured");
