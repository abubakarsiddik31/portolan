import type { JsonSchema, SiteMap } from "./types.js";

/**
 * Portable-schema lint.
 *
 * A map's op params become MCP tool input schemas, and every client accepts a
 * different subset of JSON Schema. The profile below is the intersection that
 * OpenAI strict mode, Anthropic, and Gemini all accept (BUILD_PLAN §7):
 *
 * - `type: "object"` at the root
 * - every property listed in `required`; optionality is a nullable type
 * - `additionalProperties: false`
 * - no `oneOf` / `anyOf` at the root
 * - no `$ref`
 * - no `format`-dependent validation
 *
 * Richer validation still happens server-side with Ajv; this lint only covers
 * what a client has to accept. `loadMap` does not run it, because a map can be
 * valid and still not be portable. The publisher runs `assertPortable`.
 */

export type LintSeverity = "error" | "warning";

export type LintIssue = {
  /** JSON Pointer into the map, e.g. `/ops/2/params/properties/qty`. */
  path: string;
  rule: string;
  message: string;
  severity: LintSeverity;
};

/** Tool names must survive every provider's naming rules. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** `site__op`, as exposed by native tool listing. */
export function toolName(site: string, op: string): string {
  return `${site}__${op}`;
}

export class MapLintError extends Error {
  readonly issues: LintIssue[];

  constructor(issues: LintIssue[]) {
    const summary = issues
      .slice(0, 5)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join("; ");
    super(
      `site map is not portable: ${summary}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`,
    );
    this.name = "MapLintError";
    this.issues = issues;
  }
}

/** All issues, including warnings. */
export function lintMap(map: SiteMap): LintIssue[] {
  const issues: LintIssue[] = [];

  map.ops.forEach((op, index) => {
    const base = `/ops/${index}`;

    lintParams(op.params, `${base}/params`, issues);
    lintReturns(op.returns, `${base}/returns`, issues);
    lintSummary(op.summary, `${base}/summary`, issues);

    if (op.post.length === 0) {
      issues.push({
        path: `${base}/post`,
        rule: "op/no-post",
        severity: "warning",
        message: "op has no post-check, so success cannot be verified",
      });
    }

    if (op.name.includes("__")) {
      issues.push({
        path: `${base}/name`,
        rule: "tool/separator",
        severity: "error",
        message: 'op names must not contain "__", which separates site and op in a tool name',
      });
    }

    issues.push(...lintToolName(toolName(map.site, op.name), `${base}/name`));
  });

  return issues;
}

/** Throw if the map has any lint error. Warnings are returned to the caller. */
export function assertPortable(map: SiteMap): LintIssue[] {
  const issues = lintMap(map);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new MapLintError(errors);
  }
  return issues;
}

export function lintToolName(name: string, path = "/"): LintIssue[] {
  if (TOOL_NAME_PATTERN.test(name)) return [];
  return [
    {
      path,
      rule: "tool/name",
      severity: "error",
      message: `tool name "${name}" must match ${TOOL_NAME_PATTERN.source}`,
    },
  ];
}

function lintParams(schema: JsonSchema, path: string, issues: LintIssue[]): void {
  if (schema.type !== "object") {
    issues.push({
      path: `${path}/type`,
      rule: "portable/root-object",
      severity: "error",
      message: 'params must declare type: "object" at the root',
    });
  }

  if (schema.additionalProperties !== false) {
    issues.push({
      path: `${path}/additionalProperties`,
      rule: "portable/closed-object",
      severity: "error",
      message: "params must set additionalProperties: false",
    });
  }

  if ("oneOf" in schema || "anyOf" in schema) {
    issues.push({
      path,
      rule: "portable/no-root-union",
      severity: "error",
      message: "params must not use oneOf or anyOf at the root",
    });
  }

  walk(schema, path, issues, true);

  const properties = asRecord(schema.properties);
  if (properties === undefined) return;

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  for (const key of Object.keys(properties)) {
    if (required.has(key)) continue;
    issues.push({
      path: `${path}/required`,
      rule: "portable/required-complete",
      severity: "error",
      message: `property "${key}" must be listed in required; express optionality as a nullable type`,
    });
  }
}

function lintReturns(schema: JsonSchema, path: string, issues: LintIssue[]): void {
  // Returns are validated server-side with Ajv, so `format` is allowed. A
  // `$ref` is still rejected: the schema is compiled on its own, with no base
  // document to resolve against.
  walk(schema, path, issues, false);
}

function lintSummary(summary: string, path: string, issues: LintIssue[]): void {
  if (summary.includes("\n")) {
    issues.push({
      path,
      rule: "op/summary-single-line",
      severity: "error",
      message: "summary must be one line",
    });
  }
  if (summary.length > 200) {
    issues.push({
      path,
      rule: "op/summary-length",
      severity: "error",
      message: "summary must be at most 200 characters",
    });
  }
}

function walk(value: unknown, path: string, issues: LintIssue[], banFormat: boolean): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}/${index}`, issues, banFormat);
    });
    return;
  }

  const record = asRecord(value);
  if (record === undefined) return;

  if ("$ref" in record) {
    issues.push({
      path: `${path}/$ref`,
      rule: "portable/no-ref",
      severity: "error",
      message: "op schemas must not use $ref; inline the schema",
    });
  }

  if (banFormat && "format" in record) {
    issues.push({
      path: `${path}/format`,
      rule: "portable/no-format",
      severity: "error",
      message: "op params must not depend on format validation",
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "$ref" || key === "format") continue;
    walk(child, `${path}/${key}`, issues, banFormat);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
