import { existsSync, readFileSync } from "node:fs";

import { QaError } from "./errors.js";

export type Fixtures = Record<string, Record<string, unknown>>;

export type ResolveContext = {
  fixtures: Fixtures;
  env: NodeJS.ProcessEnv;
  redact: string[];
};

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
 * literal placeholder. Secrets are redacted before anything is written.
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
      const found = context.env[path];
      if (found === undefined) {
        throw new QaError("fixture_missing", `environment variable ${path} is not set`);
      }
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

/** Replace every configured secret-like token in a string. */
export function redactText(value: string, redact: string[]): string {
  let result = value;
  for (const token of redact) {
    if (token.length === 0) continue;
    const pattern = new RegExp(escapeRegExp(token), "gi");
    result = result.replace(pattern, "[redacted]");
  }
  return result;
}

/** Deep-redact values whose key looks secret. */
export function redactValues(value: unknown, redact: string[]): unknown {
  if (typeof value === "string") return redactText(value, redact);
  if (Array.isArray(value)) return value.map((item) => redactValues(item, redact));

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const secretKey = redact.some((token) => key.toLowerCase().includes(token.toLowerCase()));
      result[key] = secretKey ? "[redacted]" : redactValues(item, redact);
    }
    return result;
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
