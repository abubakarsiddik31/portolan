import type { SiteMap } from "@abubakarsiddiik/protocol";

import { governedMap, pendingMap, type QaCase } from "./spec.js";

/**
 * What is wrong with the op a case says governs it. An empty list means the
 * link is real: the op exists in that map version, has the case's effect, and
 * an irreversible op is called with `confirm`.
 */
export function mapProblems(
  spec: QaCase,
  loadMap: (site: string, version?: number) => SiteMap | undefined,
): string[] {
  const ref = governedMap(spec);
  if (ref === undefined) return [];

  const map = loadMap(ref.site, ref.version);
  if (map === undefined) return [`map ${ref.site} v${ref.version} was not found`];

  const op = map.ops.find((candidate) => candidate.name === ref.op);
  if (op === undefined) {
    const known = map.ops.map((candidate) => candidate.name).slice(0, 8);
    return [
      `op "${ref.op}" is not in ${ref.site} v${ref.version}${known.length > 0 ? ` (it has: ${known.join(", ")})` : ""}`,
    ];
  }

  const problems: string[] = [];
  if (op.effect !== spec.effect) {
    problems.push(`op "${op.name}" is a ${op.effect} op but the case says effect: ${spec.effect}`);
  }
  if (op.effect === "irreversible") {
    const calls = [...spec.setup, ...spec.steps].filter(
      (step): step is { op: string; confirm?: boolean } => "op" in step && step.op === op.name,
    );
    if (calls.some((step) => step.confirm !== true)) {
      problems.push(`op "${op.name}" is irreversible, so its step needs confirm: true`);
    }
  }
  return problems;
}

/** Write cases that name no op yet, with the reason they gave. */
export function pendingLinks(specs: QaCase[]): Array<{ id: string; reason: string }> {
  return specs.flatMap((spec) => {
    const reason = pendingMap(spec);
    return reason === undefined ? [] : [{ id: spec.id, reason }];
  });
}
