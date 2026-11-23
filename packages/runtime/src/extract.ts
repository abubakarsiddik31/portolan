import {
  type CompositeExtractor,
  coerceJsonSchema,
  type Extractor,
  type Locator,
  type OpDef,
  type PostCheck,
  type RowsExtractor,
  type SiteMap,
} from "@abubakarsiddiik/protocol";
import type { SemanticNode, Snapshot, SubstrateView } from "@abubakarsiddiik/substrate";

import { matchingNodes, recognizeState } from "./state.js";

export type ExtractResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Pull the op's return value out of a document.
 *
 * Extractors are tier-agnostic: a `url`, `http` or `ui` impl all end with the
 * same `Extractor`, and all of them must produce a value that matches the
 * op's `returns` schema.
 */
export function extract(extractor: Extractor, view: SubstrateView): ExtractResult {
  switch (extractor.kind) {
    case "none":
      return { ok: true, value: {} };
    case "fields":
      return extractFields(extractor.fields, view);
    case "rows":
      return extractRows(extractor, view);
    case "composite":
      return extractComposite(extractor, view);
    case "json":
      return {
        ok: false,
        message: "json extractors are only valid for the http tier",
      };
    case "download":
      return {
        ok: false,
        message: "download extractors are not supported yet",
      };
  }
}

/** Validate an extracted value against the op's `returns` schema. */
export function validateReturns(op: OpDef, value: unknown): ExtractResult {
  const validation = coerceJsonSchema(op.returns, value);

  if (validation.ok) return { ok: true, value };

  return {
    ok: false,
    message: `returns for "${op.name}" did not validate`,
    details: { issues: validation.issues, value },
  };
}

/** Check one `post` condition. Returns a failure message, or undefined. */
export function checkPost(check: PostCheck, map: SiteMap, view: SubstrateView): string | undefined {
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
      if (check.search !== undefined) {
        const search = searchOf(view.snapshot.url);
        if (!new RegExp(check.search).test(search)) {
          return `query "${search}" did not match ${check.search}`;
        }
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

function searchOf(url: string): string {
  try {
    return new URL(url).search.replace(/^\?/, "");
  } catch {
    return "";
  }
}

function extractFields(fields: Record<string, Locator>, view: SubstrateView): ExtractResult {
  const result: Record<string, unknown> = {};

  for (const [key, locator] of Object.entries(fields)) {
    const node = matchingNodes(view.snapshot.nodes, locator, { visibleOnly: false })[0];
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
  const container = matchingNodes(view.snapshot.nodes, extractor.container, {
    visibleOnly: false,
  })[0];
  if (container === undefined) {
    return {
      ok: false,
      message: "rows container did not resolve",
      details: { locator: extractor.container },
    };
  }

  const scope = descendants(view.snapshot, container);
  const rows = matchingNodes(scope, extractor.row, { visibleOnly: false });
  const values: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const rowScope = descendants(view.snapshot, row, true);
    const cols: Record<string, unknown> = {};

    for (const [key, locator] of Object.entries(extractor.cols)) {
      const node = matchingNodes(rowScope, locator, { visibleOnly: false })[0];
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

  if (locator.attribute !== undefined) {
    value = attributeValue(snapshot, node, locator.attribute);
  } else {
    switch (locator.attr) {
      case "value":
        value = node.attributes?.value ?? node.properties.value ?? node.properties.valuetext ?? "";
        break;
      case "href":
        value = node.attributes?.href ?? node.properties.url ?? "";
        break;
      case "name":
        value = node.attributes?.name ?? node.name;
        break;
      default:
        value = node.name.length > 0 ? node.name : textOf(snapshot, node);
        break;
    }
  }

  if (locator.pattern !== undefined && typeof value === "string") {
    const match = new RegExp(locator.pattern).exec(value);
    if (match?.[1] !== undefined) return match[1];
  }

  return value;
}

function attributeValue(snapshot: Snapshot, node: SemanticNode, name: string): string {
  const own = node.attributes?.[name];
  if (own !== undefined) return own;

  const byId = new Map(snapshot.nodes.map((candidate) => [candidate.nodeId, candidate]));
  const stack = [...node.childIds];

  while (stack.length > 0) {
    const id = stack.shift();
    if (id === undefined) continue;

    const child = byId.get(id);
    if (child === undefined) continue;

    const value = child.attributes?.[name];
    if (value !== undefined) return value;

    stack.push(...child.childIds);
  }

  return "";
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
