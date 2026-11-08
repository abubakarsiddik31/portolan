import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { JsonSchema } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});

const coercingAjv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  coerceTypes: true,
});

export type ValidationIssue = {
  /** JSON Pointer into the value, e.g. `/qty`. */
  path: string;
  message: string;
};

export type SchemaValidation = { ok: true } | { ok: false; issues: ValidationIssue[] };

/**
 * Validate a value against a JSON Schema taken from a map.
 *
 * Ajv caches compiled schemas by object identity, so repeated calls with the
 * same op schema do not recompile it.
 */
export function validateJsonSchema(schema: JsonSchema, value: unknown): SchemaValidation {
  const validate = ajv.compile(schema);
  if (validate(value)) return { ok: true };
  return { ok: false, issues: formatAjvIssues(validate.errors) };
}

/**
 * Validate and coerce in one pass.
 *
 * Extraction returns strings from the accessibility tree; a schema that says
 * `integer` should get `1`, not `"1"`. Ajv mutates the value in place when it
 * coerces, so callers see the typed result.
 */
export function coerceJsonSchema(schema: JsonSchema, value: unknown): SchemaValidation {
  const validate = coercingAjv.compile(schema);
  if (validate(value)) return { ok: true };
  return { ok: false, issues: formatAjvIssues(validate.errors) };
}

/** Turn Ajv errors into JSON-Pointer issues. */
export function formatAjvIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty;
    const path =
      error.keyword === "required" && typeof missing === "string"
        ? `${error.instancePath}/${missing}`
        : error.instancePath || "/";
    return { path, message: error.message ?? error.keyword };
  });
}
