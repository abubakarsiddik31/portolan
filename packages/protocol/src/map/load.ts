import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import { MAP_SCHEMA } from "./schema.js";
import type { Impl, JsonSchema, OpDef, SiteMap } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});

const validateMap = ajv.compile(MAP_SCHEMA);

export type MapIssue = {
  /** JSON Pointer into the map, e.g. `/ops/2/from/0`. */
  path: string;
  message: string;
};

export class MapValidationError extends Error {
  readonly issues: MapIssue[];

  constructor(issues: MapIssue[]) {
    const summary = issues
      .slice(0, 5)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join("; ");
    super(
      `invalid site map: ${summary}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`,
    );
    this.name = "MapValidationError";
    this.issues = issues;
  }
}

/**
 * Validate a parsed map and return it typed.
 *
 * Runs the JSON Schema first, then the cross-field rules the schema cannot
 * express: references, duplicates, and write safety.
 */
export function loadMap(data: unknown): SiteMap {
  if (!validateMap(data)) {
    throw new MapValidationError(formatIssues(validateMap.errors));
  }

  const map = data as SiteMap;
  const issues = checkReferences(map);
  if (issues.length > 0) {
    throw new MapValidationError(issues);
  }

  return map;
}

/** Parse JSON text and validate it. */
export function parseMap(json: string): SiteMap {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new MapValidationError([
      {
        path: "/",
        message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  return loadMap(data);
}

function formatIssues(errors: ErrorObject[] | null | undefined): MapIssue[] {
  return (errors ?? []).map((error) => {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty;
    const path =
      error.keyword === "required" && typeof missing === "string"
        ? `${error.instancePath}/${missing}`
        : error.instancePath || "/";
    return { path, message: error.message ?? error.keyword };
  });
}

function checkReferences(map: SiteMap): MapIssue[] {
  const issues: MapIssue[] = [];

  const states = new Map<string, number>();
  map.states.forEach((state, index) => {
    const first = states.get(state.id);
    if (first !== undefined) {
      issues.push({
        path: `/states/${index}/id`,
        message: `duplicate state id "${state.id}" (first declared at /states/${first})`,
      });
      return;
    }
    states.set(state.id, index);
  });

  const ops = new Map<string, { op: OpDef; index: number }>();
  map.ops.forEach((op, index) => {
    const first = ops.get(op.name);
    if (first !== undefined) {
      issues.push({
        path: `/ops/${index}/name`,
        message: `duplicate op name "${op.name}" (first declared at /ops/${first.index})`,
      });
      return;
    }
    ops.set(op.name, { op, index });
  });

  const requireState = (id: string, path: string): void => {
    if (!states.has(id)) {
      issues.push({ path, message: `unknown state "${id}"` });
    }
  };

  map.ops.forEach((op, index) => {
    const base = `/ops/${index}`;

    op.from.forEach((id, position) => {
      requireState(id, `${base}/from/${position}`);
    });
    op.to.forEach((id, position) => {
      requireState(id, `${base}/to/${position}`);
    });

    op.post.forEach((check, position) => {
      if (check.kind === "state") {
        requireState(check.state, `${base}/post/${position}/state`);
      }
    });

    op.impls.forEach((impl, position) => {
      checkImpl(impl, `${base}/impls/${position}`, states, issues);
    });

    if (op.effect === "irreversible") {
      if (op.confirm !== true) {
        issues.push({
          path: `${base}/confirm`,
          message: "irreversible ops must set confirm: true so the caller opts in",
        });
      }
      if (op.impls.some((impl) => impl.tier === "http" || impl.tier === "url")) {
        issues.push({
          path: `${base}/impls`,
          message: "irreversible ops may only use webmcp or ui impls",
        });
      }
    }

    if (op.effect === "write") {
      if (op.impls.some((impl) => impl.tier === "url")) {
        issues.push({
          path: `${base}/impls`,
          message: "write ops may not use a url impl; use ui, or http with an outcome_check",
        });
      }
      if (op.impls.some((impl) => impl.tier === "http") && !op.outcome_check) {
        issues.push({
          path: `${base}/outcome_check`,
          message: "write ops with an http impl need outcome_check",
        });
      }
    }

    if (op.outcome_check !== undefined) {
      const target = ops.get(op.outcome_check);
      if (target === undefined) {
        issues.push({
          path: `${base}/outcome_check`,
          message: `unknown op "${op.outcome_check}"`,
        });
      } else if (target.op.effect !== "read") {
        issues.push({
          path: `${base}/outcome_check`,
          message: `outcome_check must name a read op, but "${op.outcome_check}" is ${target.op.effect}`,
        });
      }
    }

    checkJsonSchema(op.params, `${base}/params`, issues);
    checkJsonSchema(op.returns, `${base}/returns`, issues);
  });

  if (map.auth !== undefined) {
    requireState(map.auth.state, "/auth/state");
    if (!ops.has(map.auth.login_op)) {
      issues.push({
        path: "/auth/login_op",
        message: `unknown op "${map.auth.login_op}"`,
      });
    }
  }

  for (const [name, schema] of Object.entries(map.entities)) {
    checkJsonSchema(schema, `/entities/${name}`, issues);
  }

  return issues;
}

function checkImpl(
  impl: Impl,
  path: string,
  states: Map<string, number>,
  issues: MapIssue[],
): void {
  if (impl.tier === "url") {
    if (!impl.route.startsWith("/") && !impl.route.startsWith("http")) {
      issues.push({
        path: `${path}/route`,
        message: 'route must start with "/" or "http"',
      });
    }
    return;
  }

  if (impl.tier === "ui") {
    impl.steps.forEach((step, position) => {
      if (step.do === "await_state" && !states.has(step.state)) {
        issues.push({
          path: `${path}/steps/${position}/state`,
          message: `unknown state "${step.state}"`,
        });
      }
    });
  }
}

function checkJsonSchema(schema: JsonSchema, path: string, issues: MapIssue[]): void {
  try {
    ajv.compile(schema);
  } catch (error) {
    issues.push({
      path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
