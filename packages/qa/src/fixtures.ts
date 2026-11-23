import { existsSync, readFileSync } from "node:fs";

import { QaError } from "./errors.js";

export type Fixtures = Record<string, Record<string, unknown>>;

export type ResolveContext = {
  fixtures: Fixtures;
  env: NodeJS.ProcessEnv;
  redact: string[];
  /**
   * Whether `${env.*}` may resolve here. Off for `goto`, `contains`, and
   * `pattern`: a secret in a URL leaves the machine, and one in a matcher is
   * echoed back in a failure.
   */
  allowEnv?: boolean;
  /** Called before an `${env.*}` value is read; throws to refuse. */
  beforeEnv?: () => void;
  /** Collects every resolved `${env.*}` value so output can be scrubbed. */
  secrets?: Set<string>;
};

/** Only these variables are readable from a case. */
const ENV_NAME = /^QA_[A-Za-z0-9_]+$/;

/** Values shorter than this are not scrubbed: they would blank ordinary text. */
const MIN_SECRET_LENGTH = 4;

export function loadFixtures(path: string): Fixtures {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new QaError("fixture_missing", `${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new QaError("fixture_missing", `${path} must contain a JSON object`);
  }

  const fixtures: Fixtures = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new QaError("fixture_missing", `fixture "${name}" must be an object`);
    }
    fixtures[name] = value as Record<string, unknown>;
  }

  return fixtures;
}

const PLACEHOLDER = /\$\{(fixture|env)\.([A-Za-z0-9_.-]+)\}/g;

/**
 * Resolve `${fixture.user.email}` and `${env.QA_PASSWORD}` in any JSON value.
 *
 * A missing fixture or environment variable is a typed failure, never the
 * literal placeholder. Only `QA_*` variables resolve, so a case cannot read
 * `AWS_SECRET_ACCESS_KEY`. Every resolved value is recorded in
 * `context.secrets` so the caller can scrub it from anything it writes.
 */
export function resolveValues(value: unknown, context: ResolveContext): unknown {
  if (typeof value === "string") return resolveString(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveValues(item, context));

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveValues(item, context);
    }
    return result;
  }

  return value;
}

function resolveString(value: string, context: ResolveContext): string {
  return value.replace(PLACEHOLDER, (_match, scope: string, path: string) => {
    if (scope === "env") {
      if (!ENV_NAME.test(path)) {
        throw new QaError(
          "invalid_request",
          `environment variable ${path} is not readable; cases may only reference QA_* variables`,
        );
      }
      if (context.allowEnv === false) {
        throw new QaError(
          "invalid_request",
          `\${env.${path}} is only allowed in a step's value or params`,
        );
      }
      const found = context.env[path];
      if (found === undefined) {
        throw new QaError("fixture_missing", `environment variable ${path} is not set`);
      }
      context.beforeEnv?.();
      if (found.length >= MIN_SECRET_LENGTH) context.secrets?.add(found);
      return found;
    }

    const [name, ...rest] = path.split(".");
    const fixture = name === undefined ? undefined : context.fixtures[name];
    if (fixture === undefined) {
      throw new QaError("fixture_missing", `fixture "${name ?? path}" is not defined`);
    }

    let current: unknown = fixture;
    for (const segment of rest) {
      if (current === null || typeof current !== "object") {
        throw new QaError("fixture_missing", `fixture "${path}" has no value`);
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current === undefined) {
      throw new QaError("fixture_missing", `fixture "${path}" has no value`);
    }

    return String(current);
  });
}

/**
 * Every spelling of a secret that can show up in output: raw, URL-encoded,
 * JSON-escaped, and base64.
 */
function secretForms(secrets: Iterable<string>): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    forms.add(secret);
    forms.add(encodeURIComponent(secret));
    forms.add(JSON.stringify(secret).slice(1, -1));
    forms.add(Buffer.from(secret, "utf8").toString("base64"));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

/** A case id as written, and as it appears in an evidence directory name. */
export function caseNames(id: string): string[] {
  return [id, id.replace(/[^a-zA-Z0-9._-]+/g, "__")];
}

/**
 * Replace every configured secret-like token, and every known secret value,
 * in a string. Values go first so a secret that contains a token (such as
 * `mypassword1`) is not left half-visible.
 */
export function redactText(
  value: string,
  redact: string[],
  secrets: Iterable<string> = [],
  keep: readonly string[] = [],
): string {
  // A name the author chose (a case id) is not a secret, whatever words it
  // holds. Redact around it, so `wrong-password` stays `wrong-password`.
  const names = keep.filter((name) => name.length > 0);
  if (names.length > 0) {
    const pattern = new RegExp(
      `(${[...names]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|")})`,
    );
    return value
      .split(pattern)
      .map((part, index) => (index % 2 === 1 ? part : redactText(part, redact, secrets)))
      .join("");
  }

  let result = value;
  for (const form of secretForms(secrets)) result = result.split(form).join("[redacted]");
  for (const token of redact) {
    if (token.length === 0) continue;
    const pattern = new RegExp(escapeRegExp(token), "gi");
    result = result.replace(pattern, "[redacted]");
  }
  return result;
}

/** Deep-redact values whose key looks secret, and strings holding a secret. */
export function redactValues(
  value: unknown,
  redact: string[],
  secrets: Iterable<string> = [],
  keep: readonly string[] = [],
): unknown {
  const known = [...secrets];
  return redactDeep(value, redact, known, keep);
}

function redactDeep(
  value: unknown,
  redact: string[],
  secrets: string[],
  keep: readonly string[],
): unknown {
  if (typeof value === "string") return redactText(value, redact, secrets, keep);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact, secrets, keep));

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const secretKey = redact.some((token) => key.toLowerCase().includes(token.toLowerCase()));
      result[key] = secretKey ? "[redacted]" : redactDeep(item, redact, secrets, keep);
    }
    return result;
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
