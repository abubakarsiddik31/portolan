import {
  type CompositeExtractor,
  coerceJsonSchema,
  type Extractor,
  type Locator,
  type OpDef,
  type PostCheck,
  type RowsExtractor,
  type SiteMap,
  type UiImpl,
} from "@portolan/protocol";
import type {
  ActResult,
  Effect,
  SemanticNode,
  Snapshot,
  Substrate,
  SubstrateView,
} from "@portolan/substrate";

import { matchingNodes, recognizeState } from "./state.js";

export type UiRunInput = {
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
  substrate: Substrate;
};

export type UiRunResult =
  | { ok: true; result: unknown; state: string; effects: Effect[] }
  | {
      ok: false;
      code: "precondition_failed";
      message: string;
      current_state?: string;
    }
  | { ok: false; code: "op_broken"; message: string; details?: Record<string, unknown> }
  | {
      ok: false;
      code: "invalid_params";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Run a `ui` op: resolve each step's locator to a ref, act through the
 * substrate, wait for the declared states, check the postconditions, extract
 * the return value, and validate it against the op's schema.
 */
export async function runUiOp(input: UiRunInput): Promise<UiRunResult> {
  const { map, op, params, substrate } = input;

  const impl = op.impls.find((candidate): candidate is UiImpl => candidate.tier === "ui");
  if (impl === undefined) {
    return { ok: false, code: "op_broken", message: `op "${op.name}" has no ui impl` };
  }

  let view = await substrate.view();
  const initial = recognizeState(map, view.snapshot);

  if (initial === undefined || !op.from.includes(initial.state.id)) {
    return {
      ok: false,
      code: "precondition_failed",
      message: `op "${op.name}" needs ${op.from.join(" or ")}, found ${
        initial?.state.id ?? "unknown"
      }`,
      ...(initial !== undefined ? { current_state: initial.state.id } : {}),
    };
  }

  const effects: Effect[] = [];

  for (const [index, step] of impl.steps.entries()) {
    if (step.do === "await_state") {
      view = await substrate.view();
      const match = recognizeState(map, view.snapshot);

      if (match?.state.id !== step.state) {
        return {
          ok: false,
          code: "op_broken",
          message: `step ${index}: expected state "${step.state}", found "${
            match?.state.id ?? "unknown"
          }"`,
        };
      }

      continue;
    }

    if (step.do === "press") {
      return {
        ok: false,
        code: "op_broken",
        message: "press is not supported by the ui executor yet",
      };
    }

    const ref = resolveRef(view, step.target);
    if (ref === undefined) {
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: locator did not resolve`,
        details: { locator: step.target },
      };
    }

    if (step.do === "fill" || step.do === "select") {
      const value = fillTemplate(step.value, params);
      if (value === undefined) {
        return {
          ok: false,
          code: "invalid_params",
          message: `step ${index}: missing param in "${step.value}"`,
        };
      }

      const result = await substrate.act({ ref, do: step.do, value });
      if (!result.ok) return fromAct(result, index);

      effects.push(...result.effects);
      view = substrate.state() ?? (await substrate.view());
      continue;
    }

    const result = await substrate.act({ ref, do: step.do });
    if (!result.ok) return fromAct(result, index);

    effects.push(...result.effects);
    view = substrate.state() ?? (await substrate.view());
  }

  view = await substrate.view();

  for (const check of op.post) {
    const failure = checkPost(check, map, view);
    if (failure !== undefined) {
      return { ok: false, code: "op_broken", message: failure };
    }
  }

  const extracted = extract(impl.extract, view);
  if (!extracted.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: extracted.message,
      ...(extracted.details !== undefined ? { details: extracted.details } : {}),
    };
  }

  const validation = coerceJsonSchema(op.returns, extracted.value);
  if (!validation.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: `returns for "${op.name}" did not validate`,
      details: { issues: validation.issues, value: extracted.value },
    };
  }

  const finalState = recognizeState(map, view.snapshot);

  return {
    ok: true,
    result: extracted.value,
    state: finalState?.state.id ?? "unknown",
    effects,
  };
}

function resolveRef(view: SubstrateView, locator: Locator): string | undefined {
  for (const node of matchingNodes(view.snapshot.nodes, locator)) {
    const entry = view.refs.byNode.get(node.nodeId);
    if (entry !== undefined) return entry.ref;
  }

  return undefined;
}

function fillTemplate(template: string, params: Record<string, unknown>): string | undefined {
  let missing = false;

  const value = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const param = params[key];
    if (param === undefined) {
      missing = true;
      return "";
    }
    return String(param);
  });

  return missing ? undefined : value;
}

function fromAct(result: Extract<ActResult, { ok: false }>, index: number): UiRunResult {
  switch (result.code) {
    case "stale_ref":
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: stale ref`,
        details: { new_ref: result.new_ref },
      };
    case "not_interactive":
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: target is covered`,
        details: { blocker_ref: result.blocker_ref },
      };
    case "invalid_request":
      return {
        ok: false,
        code: "invalid_params",
        message: `step ${index}: ${result.message}`,
      };
  }
}

function checkPost(check: PostCheck, map: SiteMap, view: SubstrateView): string | undefined {
  switch (check.kind) {
    case "state": {
      const match = recognizeState(map, view.snapshot);
      if (match?.state.id !== check.state) {
        return `expected state "${check.state}", found "${match?.state.id ?? "unknown"}"`;
      }
      return undefined;
    }
    case "url": {
      const path = pathname(view.snapshot.url);
      if (!new RegExp(check.pattern).test(path)) {
        return `url "${path}" did not match ${check.pattern}`;
      }
      return undefined;
    }
    case "exists": {
      if (matchingNodes(view.snapshot.nodes, check.locator).length === 0) {
        return "expected a locator to exist";
      }
      return undefined;
    }
    case "absent": {
      if (matchingNodes(view.snapshot.nodes, check.locator).length > 0) {
        return "expected a locator to be absent";
      }
      return undefined;
    }
    case "text": {
      const node = matchingNodes(view.snapshot.nodes, check.locator)[0];
      if (node === undefined || !node.name.includes(check.contains)) {
        return `expected text "${check.contains}"`;
      }
      return undefined;
    }
  }
}

type ExtractResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; details?: Record<string, unknown> };

function extract(extractor: Extractor, view: SubstrateView): ExtractResult {
  switch (extractor.kind) {
    case "none":
      return { ok: true, value: {} };
    case "fields":
      return extractFields(extractor.fields, view);
    case "rows":
      return extractRows(extractor, view);
    case "composite":
      return extractComposite(extractor, view);
    case "download":
      return {
        ok: false,
        message: "download extractors are not supported by the ui executor yet",
      };
  }
}

function extractFields(fields: Record<string, Locator>, view: SubstrateView): ExtractResult {
  const result: Record<string, unknown> = {};

  for (const [key, locator] of Object.entries(fields)) {
    const node = matchingNodes(view.snapshot.nodes, locator)[0];
    if (node === undefined) {
      return {
        ok: false,
        message: `field "${key}" did not resolve`,
        details: { locator },
      };
    }
    result[key] = readValue(node, locator, view.snapshot);
  }

  return { ok: true, value: result };
}

function extractRows(extractor: RowsExtractor, view: SubstrateView): ExtractResult {
  const container = matchingNodes(view.snapshot.nodes, extractor.container)[0];
  if (container === undefined) {
    return {
      ok: false,
      message: "rows container did not resolve",
      details: { locator: extractor.container },
    };
  }

  const scope = descendants(view.snapshot, container);
  const rows = matchingNodes(scope, extractor.row);
  const values: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const rowScope = descendants(view.snapshot, row, true);
    const cols: Record<string, unknown> = {};

    for (const [key, locator] of Object.entries(extractor.cols)) {
      const node = matchingNodes(rowScope, locator)[0];
      if (node === undefined) {
        return {
          ok: false,
          message: `row column "${key}" did not resolve`,
          details: { locator },
        };
      }
      cols[key] = readValue(node, locator, view.snapshot);
    }

    values.push(cols);
  }

  return { ok: true, value: values };
}

function extractComposite(extractor: CompositeExtractor, view: SubstrateView): ExtractResult {
  const result: Record<string, unknown> = {};

  if (extractor.fields !== undefined) {
    const fields = extractFields(extractor.fields, view);
    if (!fields.ok) return fields;
    Object.assign(result, fields.value);
  }

  if (extractor.rows !== undefined) {
    const rows = extractRows(
      {
        kind: "rows",
        container: extractor.rows.container,
        row: extractor.rows.row,
        cols: extractor.rows.cols,
      },
      view,
    );
    if (!rows.ok) return rows;
    result[extractor.rows.as] = rows.value;
  }

  return { ok: true, value: result };
}

function descendants(snapshot: Snapshot, root: SemanticNode, includeRoot = false): SemanticNode[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  const ids = new Set<string>();
  const stack = [...root.childIds];

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || ids.has(id)) continue;
    ids.add(id);

    const node = byId.get(id);
    if (node !== undefined) stack.push(...node.childIds);
  }

  if (includeRoot) ids.add(root.nodeId);

  return snapshot.nodes.filter((node) => ids.has(node.nodeId));
}

function readValue(node: SemanticNode, locator: Locator, snapshot: Snapshot): unknown {
  let value: unknown;

  switch (locator.attr) {
    case "value":
      value = node.properties.value ?? node.properties.valuetext ?? "";
      break;
    case "href":
      value = node.properties.url ?? "";
      break;
    case "name":
      value = node.name;
      break;
    default:
      value = node.name.length > 0 ? node.name : textOf(snapshot, node);
      break;
  }

  if (locator.pattern !== undefined && typeof value === "string") {
    const match = new RegExp(locator.pattern).exec(value);
    if (match?.[1] !== undefined) return match[1];
  }

  return value;
}

function textOf(snapshot: Snapshot, node: SemanticNode): string {
  const byId = new Map(snapshot.nodes.map((candidate) => [candidate.nodeId, candidate]));
  const parts: string[] = [];

  const visit = (current: SemanticNode): void => {
    if (current.name.length > 0 && current.role === "StaticText") {
      parts.push(current.name);
    }
    for (const childId of current.childIds) {
      const child = byId.get(childId);
      if (child !== undefined) visit(child);
    }
  };

  for (const childId of node.childIds) {
    const child = byId.get(childId);
    if (child !== undefined) visit(child);
  }

  return parts.join(" ").trim();
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
