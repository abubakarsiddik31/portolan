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

/**
 * Value shapes that are credentials even when the field name is innocent.
 * A key named `note` can still hold a token; these patterns catch the common
 * formats, and a Luhn-valid card number is caught separately.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bsk_live_[0-9A-Za-z]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Replace every credential-shaped substring in a string. */
export function redactText(value: string): string {
  let result = value;
  for (const pattern of CREDENTIAL_PATTERNS) result = result.replace(pattern, REDACTED);
  return result.replace(CARD_CANDIDATE, (match) => (luhn(match) ? REDACTED : match));
}

/** True when the whole string is a credential shape. */
export function isCredentialValue(value: string): boolean {
  return redactText(value) !== value;
}

function luhn(value: string): boolean {
  const digits = value.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let double = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

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

  if (typeof value === "string") return redactText(value);

  return value;
}

/**
 * Redact a trace before it is persisted or exported.
 *
 * The action value is redacted when the target's accessible name is a
 * credential or the value has a credential shape; a later read of that same
 * ref is redacted too. Network bodies are redacted by key and by value shape,
 * so a login request body does not survive in the HAR.
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
        ...(entry.value !== undefined && (sensitive || isCredentialValue(entry.value))
          ? { value: REDACTED }
          : {}),
      };
      return redacted;
    }

    if (entry.kind === "read") {
      const text = redactText(entry.text);
      if (entry.ref !== undefined && sensitiveRefs.has(entry.ref)) {
        return { ...entry, text: REDACTED };
      }
      return text === entry.text ? entry : { ...entry, text };
    }

    return entry;
  });

  return { ...trace, entries };
}
