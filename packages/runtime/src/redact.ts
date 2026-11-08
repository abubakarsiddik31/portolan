import type { Trace, TraceAct, TraceEntry } from "./fallback.js";

/** Keys whose values must never reach a log, a trace, or an audit row. */
export const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "credential",
  "credentials",
  "card",
  "card_number",
  "cvv",
  "ssn",
  "pin",
] as const;

export const REDACTED = "[redacted]";

/** True when a field name or accessible name is a credential. */
export function isSensitiveKey(key: string | undefined): boolean {
  if (key === undefined) return false;

  const normalized = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return SENSITIVE_KEYS.some(
    (candidate) => normalized === candidate || normalized.includes(candidate),
  );
}

/** Recursively redact sensitive keys in a record, array, or scalar. */
export function redactRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactRecord(item));

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactRecord(item);
    }
    return result;
  }

  return value;
}

/**
 * Redact a trace before it is persisted or exported.
 *
 * The action value is redacted when the target's accessible name is a
 * credential; a later read of that same ref is redacted too. Network bodies
 * are redacted by key, so a login request body does not survive in the HAR.
 */
export function redactTrace(trace: Trace): Trace {
  const sensitiveRefs = new Set<string>();

  const entries: TraceEntry[] = trace.entries.map((entry) => {
    if (entry.kind === "act") {
      const sensitive = isSensitiveKey(entry.locator?.name);
      if (sensitive) sensitiveRefs.add(entry.ref);

      const effects = entry.effects.map((effect) => {
        if (effect.kind !== "network") return effect;
        return {
          ...effect,
          ...(effect.request_body !== undefined
            ? { request_body: redactRecord(effect.request_body) }
            : {}),
          ...(effect.response_body !== undefined
            ? { response_body: redactRecord(effect.response_body) }
            : {}),
        };
      });

      const redacted: TraceAct = {
        ...entry,
        effects,
        ...(sensitive && entry.value !== undefined ? { value: REDACTED } : {}),
      };
      return redacted;
    }

    if (entry.kind === "read" && entry.ref !== undefined && sensitiveRefs.has(entry.ref)) {
      return { ...entry, text: REDACTED };
    }

    return entry;
  });

  return { ...trace, entries };
}
