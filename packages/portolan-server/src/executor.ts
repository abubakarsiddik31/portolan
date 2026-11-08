import type { OpDef, ResultEnvelope, SessionRecord, SiteMap } from "@portolan/protocol";

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
  /** Optional: report how the op ran, for the audit log. */
  audit?: (info: OpAudit) => void;
};

/**
 * The op runtime behind the MCP surface.
 *
 * Kept as an injected function so the transport, session pinning, and
 * validation can be tested before the tier executors exist. The real
 * implementation lands with T2.17–T2.21.
 */
export type OpExecutor = (input: OpExecutorInput) => Promise<ResultEnvelope>;

/**
 * The executor used until the op runtime lands.
 *
 * It reports exactly where the call stopped. Returning a fake success would
 * be worse than failing: a caller would believe an order was placed.
 */
export const notReadyExecutor: OpExecutor = async ({ op }) => ({
  ok: false,
  error: {
    code: "op_broken",
    message: `op "${op.name}" reached the runtime, but execution is not implemented yet`,
    details: { stage: "executor", op: op.name },
  },
});
