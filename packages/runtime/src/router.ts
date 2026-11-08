import type { OpDef, SiteMap } from "@portolan/protocol";

export type RouteStep = {
  op: string;
  from: string;
  to: string;
};

/**
 * Find the shortest read-only path from one state to a target state.
 *
 * Returns the ops to call in order, or undefined when no read-only path
 * exists. Writes and irreversible ops are never part of a route: the runtime
 * may route to a precondition, but it never inserts an action the caller did
 * not ask for.
 */
export function routeTo(map: SiteMap, from: string, to: string): RouteStep[] | undefined {
  return routeToAny(map, from, [to]);
}

export function routeToAny(map: SiteMap, from: string, targets: string[]): RouteStep[] | undefined {
  if (targets.includes(from)) return [];

  const goal = new Set(targets);
  const queue: string[] = [from];
  const visited = new Set<string>([from]);
  const parents = new Map<string, RouteStep>();
  const ops = routableOps(map);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const op of ops) {
      if (!op.from.includes(current)) continue;

      for (const next of op.to) {
        if (visited.has(next)) continue;

        parents.set(next, { op: op.name, from: current, to: next });

        if (goal.has(next)) {
          return buildRoute(parents, from, next);
        }

        visited.add(next);
        queue.push(next);
      }
    }
  }

  return undefined;
}

/** Read ops a route may use. Broken ops are excluded; degraded ops are not. */
export function routableOps(map: SiteMap): OpDef[] {
  return map.ops.filter((op) => op.effect === "read" && op.status !== "broken");
}

function buildRoute(
  parents: Map<string, RouteStep>,
  start: string,
  end: string,
): RouteStep[] | undefined {
  const steps: RouteStep[] = [];
  let current = end;

  while (current !== start) {
    const step = parents.get(current);
    if (step === undefined) return undefined;
    steps.unshift(step);
    current = step.from;
  }

  return steps;
}
