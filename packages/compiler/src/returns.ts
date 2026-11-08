import type { ModelPort, ModelRole, Usage } from "@portolan/model";
import {
  coerceJsonSchema,
  type Extractor,
  type JsonSchema,
  type Locator,
} from "@portolan/protocol";
import { extract } from "@portolan/runtime";
import type { SemanticNode, Snapshot, SubstrateView } from "@portolan/substrate";
import { z } from "zod";

export type InferredReturns = {
  kind: "rows" | "fields" | "json" | "none";
  extractor: Extractor;
  value: unknown;
  schema: JsonSchema;
};

export type ReturnsValidation = {
  ok: boolean;
  value?: unknown;
  message?: string;
  issues?: unknown;
};

export const returnsNamesSchema = z.object({
  fields: z.record(z.string(), z.string()),
});

export type ReturnsNames = z.infer<typeof returnsNamesSchema>;

const namesJsonSchema = z.toJSONSchema(returnsNamesSchema) as Record<string, unknown>;

const NAME_SYSTEM = `You are Portolan's field namer.
You are given the current keys of an inferred return value and a sample of that value.
Return a mapping from each key to a clearer snake_case name: id, name, price, status, and so on.
Do not invent keys. Do not repeat a target name. Return only the structured object.`;

/**
 * Infer a returns extractor and JSON Schema from a post-state.
 *
 * Rows are preferred over fields: a repeated test id inside a table or grid is
 * stronger evidence than a handful of scalar nodes. The extractor is built
 * from semantic locators, never CSS, and then run against the same view so the
 * inference is checked before it is returned.
 */
export function inferReturns(view: SubstrateView): InferredReturns {
  const rows = inferRows(view);
  if (rows !== undefined) return rows;

  const fields = inferFields(view);
  if (fields !== undefined) return fields;

  return {
    kind: "none",
    extractor: { kind: "none" },
    value: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
  };
}

/** Run the inferred extractor and validate the result against the inferred schema. */
export function validateInferredReturns(
  inferred: InferredReturns,
  view: SubstrateView,
): ReturnsValidation {
  const extracted = extract(inferred.extractor, view);

  if (!extracted.ok) {
    return {
      ok: false,
      message: extracted.message,
      ...(extracted.details !== undefined ? { issues: extracted.details } : {}),
    };
  }

  const validation = coerceJsonSchema(inferred.schema, extracted.value);

  if (validation.ok) return { ok: true, value: extracted.value };
  return { ok: false, value: extracted.value, issues: validation.issues };
}

/** Ask the model to rename the inferred fields. Invalid names are rejected. */
export async function nameReturns(options: {
  model: ModelPort;
  inferred: InferredReturns;
  role?: ModelRole;
}): Promise<{ inferred: InferredReturns; renames: Record<string, string>; usage: Usage }> {
  const keys = extractorKeys(options.inferred.extractor);
  if (keys.length === 0) {
    return {
      inferred: options.inferred,
      renames: {},
      usage: { input: 0, cached_input: 0, output: 0, provider: "unknown", model: "unknown" },
    };
  }

  const decided = await options.model.object<ReturnsNames>({
    role: options.role ?? "name",
    system: NAME_SYSTEM,
    prompt: `CURRENT FIELDS: ${keys.join(", ")}\n\nSAMPLE:\n${JSON.stringify(
      options.inferred.value,
      null,
      2,
    ).slice(0, 4_000)}\n\nName every field.`,
    schema: namesJsonSchema,
    maxTokens: 600,
  });

  const renames = validateRenames(decided.value.fields, keys);
  const extractor = renameExtractor(options.inferred.extractor, renames);

  return {
    inferred: {
      ...options.inferred,
      extractor,
      value: renameValue(options.inferred.value, renames),
      schema: renameSchema(options.inferred.schema, renames),
    },
    renames,
    usage: decided.usage,
  };
}

function inferRows(view: SubstrateView): InferredReturns | undefined {
  const containers = view.snapshot.nodes.filter(
    (node) =>
      node.visible &&
      (node.role === "table" ||
        node.role === "grid" ||
        node.test_id?.endsWith("-table") === true ||
        node.test_id?.endsWith("-grid") === true),
  );

  for (const container of containers) {
    const scope = descendants(view.snapshot, container);
    const rowGroup = rowGroupOf(scope, container.test_id);
    if (rowGroup === undefined) continue;

    const rowNodes = scope.filter((node) =>
      rowGroup.testId === undefined
        ? node.role === rowGroup.role
        : node.test_id === rowGroup.testId,
    );
    if (rowNodes.length === 0) continue;

    const first = rowNodes[0];
    if (first === undefined) continue;

    const rowScope = descendants(view.snapshot, first);
    const cols = columnsOf(scope, rowScope);
    if (Object.keys(cols).length === 0) continue;

    const extractor: Extractor = {
      kind: "rows",
      container: containerLocator(container),
      row:
        rowGroup.testId === undefined
          ? { role: rowGroup.role as string }
          : { test_id: rowGroup.testId },
      cols,
    };

    const extracted = extract(extractor, view);
    if (!extracted.ok || !Array.isArray(extracted.value) || extracted.value.length === 0) continue;

    return {
      kind: "rows",
      extractor,
      value: extracted.value,
      schema: inferSchema(extracted.value),
    };
  }

  return undefined;
}

function inferFields(view: SubstrateView): InferredReturns | undefined {
  const fields: Record<string, Locator> = {};

  for (const node of view.snapshot.nodes) {
    if (!node.visible || node.test_id === undefined || node.test_id.length === 0) continue;
    if (isContainer(node) || node.test_id.endsWith("-card") || node.test_id.endsWith("-detail")) {
      continue;
    }

    const value = fieldValue(node);
    if (value === undefined || value.length === 0) continue;

    const key = normalizeKey(node.test_id);
    if (fields[key] !== undefined) continue;

    const formValue =
      node.attributes?.value !== undefined &&
      node.attributes.value.length > 0 &&
      (node.role === "textbox" || node.role === "spinbutton" || node.role === "combobox");

    fields[key] = { test_id: node.test_id, attr: formValue ? "value" : "text" };
  }

  if (Object.keys(fields).length === 0) return undefined;

  const extractor: Extractor = { kind: "fields", fields };
  const extracted = extract(extractor, view);
  if (!extracted.ok) return undefined;

  return {
    kind: "fields",
    extractor,
    value: extracted.value,
    schema: inferSchema(extracted.value),
  };
}

function rowGroupOf(
  scope: SemanticNode[],
  containerTestId: string | undefined,
): { testId?: string; role?: string } | undefined {
  const counts = new Map<string, number>();

  for (const node of scope) {
    if (node.test_id === undefined || node.test_id === containerTestId) continue;
    if (!node.visible || node.ignored) continue;
    counts.set(node.test_id, (counts.get(node.test_id) ?? 0) + 1);
  }

  let best: { testId: string; count: number } | undefined;

  for (const [testId, count] of counts) {
    if (best === undefined || count > best.count) best = { testId, count };
  }

  if (best !== undefined && best.count >= 1) return { testId: best.testId };

  for (const role of ["row", "article", "listitem"]) {
    const count = scope.filter((node) => node.role === role && node.visible).length;
    if (count >= 2) return { role };
  }

  return undefined;
}

function columnsOf(scope: SemanticNode[], rowScope: SemanticNode[]): Record<string, Locator> {
  const cells = rowScope.filter((node) => node.role === "cell" || node.role === "gridcell");

  if (cells.length > 0) {
    const headers = scope.filter((node) => node.role === "columnheader");
    const cols: Record<string, Locator> = {};

    for (const [index, cell] of cells.entries()) {
      const header = headers[index];
      const key = normalizeKey(header?.name ?? `col_${index + 1}`);
      if (cols[key] !== undefined) continue;

      const attribute = dataAttribute(cell);
      cols[key] = {
        role: cell.role,
        ordinal: index,
        ...(attribute !== undefined ? { attribute } : {}),
      };
    }

    return cols;
  }

  return cardColumns(rowScope);
}

function cardColumns(rowScope: SemanticNode[]): Record<string, Locator> {
  const cols: Record<string, Locator> = {};
  const groups = new Map<string, number>();

  for (const node of rowScope) {
    if (!node.visible || node.role === "generic" || node.role === "none") continue;
    if (node.role === "image" || node.role === "img") continue;
    if (node.role === "paragraph" && node.name.length === 0) continue;

    const ordinal = groups.get(node.role) ?? 0;
    groups.set(node.role, ordinal + 1);

    const key = ordinal === 0 ? node.role : `${node.role}_${ordinal + 1}`;
    if (cols[key] === undefined && Object.keys(cols).length < 8) {
      cols[key] = { role: node.role, ordinal };
    }

    if ((node.role === "link" || node.role === "heading") && node.attributes?.href !== undefined) {
      const hrefKey = ordinal === 0 ? `${node.role}_href` : `${node.role}_${ordinal + 1}_href`;
      if (cols[hrefKey] === undefined && Object.keys(cols).length < 8) {
        cols[hrefKey] = { role: node.role, ordinal, attribute: "href", pattern: "/([^/]+)$" };
      }
    }
  }

  return cols;
}

function containerLocator(container: SemanticNode): Locator {
  if (container.test_id !== undefined) return { test_id: container.test_id };
  return { role: container.role };
}

function dataAttribute(node: SemanticNode): string | undefined {
  if (node.attributes === undefined) return undefined;

  for (const key of Object.keys(node.attributes)) {
    if (key.startsWith("data-") && key !== "data-testid") return key;
  }

  return undefined;
}

function isContainer(node: SemanticNode): boolean {
  return (
    node.role === "table" ||
    node.role === "grid" ||
    node.role === "list" ||
    node.role === "form" ||
    node.test_id?.endsWith("-table") === true ||
    node.test_id?.endsWith("-grid") === true
  );
}

function fieldValue(node: SemanticNode): string | undefined {
  if (node.name.length > 0) return node.name;
  if (node.attributes?.value !== undefined && node.attributes.value.length > 0) {
    return node.attributes.value;
  }
  return undefined;
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

/** A returns inference from a JSON response body, for the http tier. */
export function inferJsonReturns(body: unknown): InferredReturns {
  return {
    kind: "json",
    extractor: { kind: "json", path: "" },
    value: body,
    schema: inferSchema(body),
  };
}

export function inferSchema(value: unknown): JsonSchema {
  if (Array.isArray(value)) {
    const items = value.map((item) => inferSchema(item));
    return { type: "array", items: mergeSchemas(items) };
  }

  if (value === null || value === undefined) return {};
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      properties: Object.fromEntries(entries.map(([key, item]) => [key, inferSchema(item)])),
      required: entries.map(([key]) => key),
      additionalProperties: false,
    };
  }

  return { type: "string" };
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  const first = schemas[0];
  if (first === undefined) return {};
  if (schemas.length === 1) return first;

  const types = new Set(schemas.map((schema) => schema.type));
  if (types.size !== 1) return {};

  if (first.type === "object") {
    const objects = schemas as Array<{
      type: "object";
      properties?: Record<string, JsonSchema>;
      required?: string[];
    }>;
    const properties: Record<string, JsonSchema> = {};
    const all = new Map<string, JsonSchema[]>();

    for (const object of objects) {
      for (const [key, schema] of Object.entries(object.properties ?? {})) {
        const list = all.get(key) ?? [];
        list.push(schema);
        all.set(key, list);
      }
    }

    for (const [key, list] of all) properties[key] = mergeSchemas(list);

    const required = (objects[0]?.required ?? []).filter((key) =>
      objects.every((object) => object.required?.includes(key) === true),
    );

    return { type: "object", properties, required, additionalProperties: false };
  }

  if (first.type === "array") {
    const arrays = schemas as Array<{ type: "array"; items?: JsonSchema }>;
    return { type: "array", items: mergeSchemas(arrays.map((array) => array.items ?? {})) };
  }

  return first;
}

function normalizeKey(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key.length > 0 ? key : "value";
}

function extractorKeys(extractor: Extractor): string[] {
  switch (extractor.kind) {
    case "rows":
      return Object.keys(extractor.cols);
    case "fields":
      return Object.keys(extractor.fields);
    case "composite":
      return [
        ...Object.keys(extractor.fields ?? {}),
        ...(extractor.rows === undefined ? [] : Object.keys(extractor.rows.cols)),
      ];
    default:
      return [];
  }
}

function validateRenames(fields: Record<string, string>, keys: string[]): Record<string, string> {
  const renames: Record<string, string> = {};
  const seen = new Set<string>();

  for (const [from, to] of Object.entries(fields)) {
    if (!keys.includes(from)) throw new Error(`the model renamed unknown field "${from}"`);
    if (!/^[a-z][a-z0-9_]*$/.test(to)) throw new Error(`"${to}" is not a snake_case field name`);
    if (seen.has(to)) throw new Error(`the model reused the field name "${to}"`);
    seen.add(to);
    renames[from] = to;
  }

  return renames;
}

function renameExtractor(extractor: Extractor, renames: Record<string, string>): Extractor {
  switch (extractor.kind) {
    case "rows":
      return { ...extractor, cols: renameRecord(extractor.cols, renames) };
    case "fields":
      return { ...extractor, fields: renameRecord(extractor.fields, renames) };
    case "composite":
      return {
        ...extractor,
        ...(extractor.fields !== undefined
          ? { fields: renameRecord(extractor.fields, renames) }
          : {}),
        ...(extractor.rows !== undefined
          ? { rows: { ...extractor.rows, cols: renameRecord(extractor.rows.cols, renames) } }
          : {}),
      };
    default:
      return extractor;
  }
}

function renameRecord<T>(
  record: Record<string, T>,
  renames: Record<string, string>,
): Record<string, T> {
  const result: Record<string, T> = {};

  for (const [key, value] of Object.entries(record)) {
    result[renames[key] ?? key] = value;
  }

  return result;
}

function renameValue(value: unknown, renames: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => renameValue(item, renames));
  if (value === null || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[renames[key] ?? key] = renameValue(item, renames);
  }
  return result;
}

function renameSchema(schema: JsonSchema, renames: Record<string, string>): JsonSchema {
  if (schema.type === "array" && typeof schema.items === "object" && schema.items !== null) {
    return { ...schema, items: renameSchema(schema.items as JsonSchema, renames) };
  }

  if (
    schema.type !== "object" ||
    typeof schema.properties !== "object" ||
    schema.properties === null
  ) {
    return schema;
  }

  const properties = schema.properties as Record<string, JsonSchema>;
  const renamed: Record<string, JsonSchema> = {};

  for (const [key, value] of Object.entries(properties)) {
    renamed[renames[key] ?? key] = value;
  }

  const required = Array.isArray(schema.required)
    ? schema.required.map((key) => (typeof key === "string" ? (renames[key] ?? key) : key))
    : schema.required;

  return { ...schema, properties: renamed, ...(required !== undefined ? { required } : {}) };
}
