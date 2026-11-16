export type QaErrorCode =
  | "not_found"
  | "not_interactive"
  | "stale_ref"
  | "timeout"
  | "navigation"
  | "assertion_failed"
  | "value_lost"
  | "precondition_failed"
  | "op_failed"
  | "unknown_outcome"
  | "fixture_missing"
  | "harness_error"
  | "invalid_request"
  | "unverified"
  | "flaky"
  | "not_implemented"
  | "spec_error"
  | "store_error";

/** A typed QA failure. `code` is the contract an agent branches on. */
export class QaError extends Error {
  readonly code: QaErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: QaErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "QaError";
    this.code = code;
    this.details = details;
  }
}
