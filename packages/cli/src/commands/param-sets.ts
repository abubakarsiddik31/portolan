import type { OpDef } from "@abubakarsiddiik/protocol";

/**
 * The three or more param sets an op is verified with, or undefined when it
 * needs a params file.
 *
 * An explicit list wins. A read can be probed with observed or synthetic
 * values; a write only ever runs with values a person supplied or a recorded
 * run observed.
 */
export function paramSetsFor(
  op: OpDef,
  observed: Array<Record<string, unknown>> | undefined,
  explicit: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (explicit !== undefined) return explicit.length >= 3 ? explicit : undefined;

  const sample = observed ?? [];
  const required = requiredParams(op);
  if (required.length === 0) return [{}, {}, {}];

  if (op.effect !== "read") {
    return sample.length >= 3 ? sample : undefined;
  }

  // A read can be probed with synthetic values: a wrong search term or a
  // missing id fails verification instead of changing data.
  const seeds = sample.length > 0 ? sample : [defaults(op)];
  const filled = seeds.map((set) => fillMissing(op, set));

  while (filled.length < 3) {
    filled.push(variant(op, filled[filled.length - 1] ?? {}, filled.length + 1));
  }

  return filled;
}

function defaults(op: OpDef): Record<string, unknown> {
  const properties = op.params.properties;
  if (typeof properties !== "object" || properties === null) return {};

  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(properties as Record<string, unknown>)) {
    const type = (schema as { type?: string }).type;
    if (type === "number" || type === "integer") out[name] = 1;
    else if (type === "boolean") continue;
    else out[name] = "test";
  }
  return out;
}

function fillMissing(op: OpDef, sample: Record<string, unknown>): Record<string, unknown> {
  const next = { ...defaults(op), ...sample };
  return next;
}

function variant(
  op: OpDef,
  sample: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...sample };
  for (const name of requiredParams(op)) {
    const value = next[name];
    if (typeof value === "number") next[name] = value + index;
    else if (typeof value === "string") next[name] = `${value}${index}`;
  }
  return next;
}

function requiredParams(op: OpDef): string[] {
  const required = op.params.required;
  if (!Array.isArray(required)) return [];
  return required.filter((name): name is string => typeof name === "string");
}
