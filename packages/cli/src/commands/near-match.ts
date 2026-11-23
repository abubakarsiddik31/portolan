import type { OpDef, UiStep } from "@abubakarsiddiik/protocol";

const WORD = /[a-z0-9]+/g;

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(WORD) ?? []);
}

/** How alike two control names are, 0 to 1: shared words, with a floor for containment. */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;

  const shared = [...left].filter((word) => right.has(word)).length;
  const jaccard = shared / (left.size + right.size - shared);
  const contains =
    a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
  return contains ? Math.max(jaccard, 0.6) : jaccard;
}

/** The one visible control with the same role and a clearly closest name, or none. */
export function nearestControl(
  role: string,
  name: string,
  nodes: Array<{ role: string; name: string; visible: boolean }>,
  threshold = 0.5,
): string | undefined {
  const scored = nodes
    .filter((node) => node.role === role && node.visible && node.name.length > 0)
    .map((node) => ({ name: node.name, score: similarity(name, node.name) }))
    .filter((candidate) => candidate.score >= threshold && candidate.name !== name)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Two equally close candidates is a guess, not a repair.
  if (best === undefined || scored[1]?.score === best.score) return undefined;
  return best.name;
}

/**
 * A copy of a ui op whose click, fill and select targets point at the nearest
 * control on the page now. Undefined when nothing needed changing, or any
 * target has no clear match.
 */
export function repairLocators(
  op: OpDef,
  nodes: Array<{ role: string; name: string; visible: boolean }>,
): OpDef | undefined {
  let changed = false;
  let ok = true;

  const impls = op.impls.map((impl) => {
    if (impl.tier !== "ui") return impl;

    const steps = impl.steps.map((step): UiStep => {
      if (step.do === "await_state" || step.do === "press") return step;
      const { role, name } = step.target;
      if (role === undefined || name === undefined) return step;
      if (nodes.some((node) => node.role === role && node.visible && node.name === name))
        return step;

      const near = nearestControl(role, name, nodes);
      if (near === undefined) {
        ok = false;
        return step;
      }
      changed = true;
      return { ...step, target: { ...step.target, name: near } } as UiStep;
    });
    return { ...impl, steps };
  });

  return ok && changed ? { ...op, impls } : undefined;
}
