import { z } from "zod";

/**
 * Every failure the runtime is allowed to return.
 *
 * These are a contract, not diagnostics: a caller's agent branches on `code`,
 * so a new failure mode must get a new code instead of being folded into a
 * generic error string. See BUILD_PLAN §5.5 and SUBSTRATE.md §4.
 */
export const ERROR_CODES = [
  "invalid_request",
  "invalid_params",
  "precondition_failed",
  "needs_auth",
  "needs_confirmation",
  "unknown_op",
  "op_broken",
  "unknown_outcome",
  "blocked",
  "timeout",
  "stale_ref",
  "not_interactive",
  "map_not_found",
  "session_not_found",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One line per code, for docs and for the generated error reference. */
export const ERROR_DESCRIPTIONS = {
  invalid_request: "The call envelope is malformed.",
  invalid_params: "The params failed the op's JSON Schema.",
  precondition_failed:
    "The session is not in one of the op's `from` states. Carries the current state and the shortest read-only route.",
  needs_auth: "The session is signed out and the op needs an authenticated state.",
  needs_confirmation: "An irreversible op was called without `confirm: true`.",
  unknown_op: "No op with that name exists in the session's pinned map.",
  op_broken: "Every verified impl failed. Carries a fallback scope for the caller's agent.",
  unknown_outcome: "A write may or may not have happened. Never retry; reconcile first.",
  blocked: "A bot wall, CAPTCHA, or access denial stopped the session.",
  timeout: "The call exceeded its deadline.",
  stale_ref: "A substrate ref no longer resolves in the current document.",
  not_interactive: "A hit-test landed on another node, such as an overlay.",
  map_not_found: "No map is registered for the requested site.",
  session_not_found: "The session id is unknown, closed, or expired.",
  internal: "An unexpected runtime error. A bug, not a caller mistake.",
} satisfies Record<ErrorCode, string>;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const protocolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  /**
   * Structured, code-specific evidence. `precondition_failed` carries
   * `current_state` and `route`; `op_broken` carries `scope_id`; a schema miss
   * carries `issues`. Callers should prefer this over parsing `message`.
   */
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export function protocolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ProtocolError {
  return details === undefined ? { code, message } : { code, message, details };
}
