import { z } from "zod";

import { protocolErrorSchema } from "./errors.js";
import { meterSchema } from "./meter.js";

/**
 * The single shape every runtime response takes, over MCP and HTTP alike.
 *
 * `ok: true` carries the typed result. `ok: false` carries a code the caller
 * can branch on. `meter` is present on both, including errors, so a failed
 * call is still measured.
 */
export const resultEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: z.unknown(),
    meter: meterSchema.optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: protocolErrorSchema,
    meter: meterSchema.optional(),
  }),
]);

export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;
