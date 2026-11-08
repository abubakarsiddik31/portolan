import { z } from "zod";

/** `open_site(site)` — pins a map version and opens a session. */
export const openSiteRequestSchema = z.object({
  site: z.string().min(1).max(64),
});

export type OpenSiteRequest = z.infer<typeof openSiteRequestSchema>;

/**
 * `call(op, params, idempotency_key?, confirm?)`.
 *
 * `confirm` is required only for irreversible ops. `idempotency_key` lets a
 * caller retry safely after a transport failure: if the effect already
 * happened, the runtime returns the existing result instead of repeating it.
 */
export const callRequestSchema = z.object({
  op: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().min(1).max(200).optional(),
  confirm: z.boolean().optional(),
});

export type CallRequest = z.infer<typeof callRequestSchema>;

export const sessionSchema = z.object({
  sid: z.string().min(1),
  site: z.string().min(1),
  map_version: z.number().int().positive(),
  state: z.string().min(1).optional(),
});

export type Session = z.infer<typeof sessionSchema>;
