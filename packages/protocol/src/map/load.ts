import { Ajv2020 } from "ajv/dist/2020.js";

import { MAP_SCHEMA } from "./schema.js";
import type { Extractor, Impl, JsonSchema, Locator, OpDef, SiteMap } from "./types.js";
import { formatAjvIssues, type ValidationIssue } from "./validate.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});

const validateMap = ajv.compile(MAP_SCHEMA);

export type MapIssue = ValidationIssue;

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
    throw new MapValidationError(formatAjvIssues(validateMap.errors));
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

  for (const { locator, path } of locatorsOf(map)) {
    if (locator.pattern === undefined) continue;
    try {
      new RegExp(locator.pattern);
    } catch (error) {
      issues.push({
        path: `${path}/pattern`,
        message: `invalid regular expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  return issues;
}

/** Every locator in the map, with its JSON Pointer. */
function* locatorsOf(map: SiteMap): Generator<{ locator: Locator; path: string }> {
  for (const [stateIndex, state] of map.states.entries()) {
    for (const [position, locator] of state.marks.entries()) {
      yield { locator, path: `/states/${stateIndex}/marks/${position}` };
    }
    for (const [position, locator] of (state.not ?? []).entries()) {
      yield { locator, path: `/states/${stateIndex}/not/${position}` };
    }
  }

  for (const [opIndex, op] of map.ops.entries()) {
    for (const [position, check] of op.post.entries()) {
      if (check.kind === "exists" || check.kind === "absent" || check.kind === "text") {
        yield { locator: check.locator, path: `/ops/${opIndex}/post/${position}/locator` };
      }
    }

    for (const [implIndex, impl] of op.impls.entries()) {
      if (impl.tier === "url" || impl.tier === "http" || impl.tier === "ui") {
        yield* extractorLocators(impl.extract, `/ops/${opIndex}/impls/${implIndex}/extract`);
      }
      if (impl.tier === "ui") {
        for (const [stepIndex, step] of impl.steps.entries()) {
          if ("target" in step) {
            yield {
              locator: step.target,
              path: `/ops/${opIndex}/impls/${implIndex}/steps/${stepIndex}/target`,
            };
          }
        }
      }
    }
  }
}

function* extractorLocators(
  extractor: Extractor,
  path: string,
): Generator<{ locator: Locator; path: string }> {
  if (extractor.kind === "fields") {
    for (const [name, locator] of Object.entries(extractor.fields)) {
      yield { locator, path: `${path}/fields/${name}` };
    }
    return;
  }

  if (extractor.kind === "rows") {
    yield { locator: extractor.container, path: `${path}/container` };
    yield { locator: extractor.row, path: `${path}/row` };
    for (const [name, locator] of Object.entries(extractor.cols)) {
      yield { locator, path: `${path}/cols/${name}` };
    }
    return;
  }

  if (extractor.kind === "composite") {
    for (const [name, locator] of Object.entries(extractor.fields ?? {})) {
      yield { locator, path: `${path}/fields/${name}` };
    }
    if (extractor.rows !== undefined) {
      yield { locator: extractor.rows.container, path: `${path}/rows/container` };
      yield { locator: extractor.rows.row, path: `${path}/rows/row` };
      for (const [name, locator] of Object.entries(extractor.rows.cols)) {
        yield { locator, path: `${path}/rows/cols/${name}` };
      }
    }
  }
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
