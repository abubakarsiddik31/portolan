import type { Locator, SiteMap, StateDef } from "@portolan/protocol";
import type { SemanticNode, Snapshot } from "@portolan/substrate";

export type StateMatch = {
  state: StateDef;
  /** Number of marks that matched; more marks means more specific. */
  marks: number;
};

const FORM_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "spinbutton",
  "slider",
  "switch",
]);

/**
 * Which state is this document in?
 *
 * A state matches when its URL pattern matches and every mark is present and
 * every `not` locator is absent. When several states match, the one with more
 * marks wins, then the one with a URL. A tie keeps declaration order.
 */
export function recognizeState(map: SiteMap, snapshot: Snapshot): StateMatch | undefined {
  const candidates: StateMatch[] = [];

  for (const state of map.states) {
    if (state.url !== undefined && !matchUrl(state.url, snapshot.url)) continue;
    if (!state.marks.every((locator) => matchesLocator(snapshot.nodes, locator))) {
      continue;
    }
    if (state.not?.some((locator) => matchesLocator(snapshot.nodes, locator)) === true) {
      continue;
    }

    candidates.push({ state, marks: state.marks.length });
  }

  candidates.sort(
    (a, b) =>
      b.marks - a.marks ||
      (a.state.url === undefined ? 1 : 0) - (b.state.url === undefined ? 1 : 0),
  );

  return candidates[0];
}

export function matchesLocator(nodes: SemanticNode[], locator: Locator): boolean {
  return matchingNodes(nodes, locator).length > 0;
}

/**
 * Resolve a map locator against a semantic snapshot.
 *
 * `test_id` matches the author's hook, `label` matches a form control by its
 * accessible name, and `role` matches with optional `name` / `name_re`.
 * `ctx` and `attr` are extraction hints, not identity, so they are ignored.
 */
export function matchingNodes(nodes: SemanticNode[], locator: Locator): SemanticNode[] {
  const matches = nodes.filter((node) => {
    if (!node.visible) return false;

    if (locator.test_id !== undefined) {
      return node.test_id === locator.test_id;
    }

    if (locator.label !== undefined) {
      return node.name === locator.label && FORM_ROLES.has(node.role);
    }

    if (locator.role === undefined || node.role !== locator.role) return false;
    if (locator.name !== undefined && node.name !== locator.name) return false;
    if (locator.name_re !== undefined && !new RegExp(locator.name_re).test(node.name)) {
      return false;
    }

    return true;
  });

  if (locator.ordinal === undefined) return matches;

  const selected = matches[locator.ordinal];
  return selected === undefined ? [] : [selected];
}

/** Match a path pattern such as `/p/:id` or `/search` against a URL. */
export function matchUrl(pattern: string, url: string): boolean {
  let pathname: string;

  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  const path = pattern.split("?")[0] ?? "";
  const patternParts = path.split("/");
  const urlParts = pathname.split("/");

  if (patternParts.length !== urlParts.length) return false;

  return patternParts.every((part, index) => {
    const actual = urlParts[index];
    if (actual === undefined) return false;
    if (part === "*") return true;
    if (part.startsWith(":")) return actual.length > 0;
    return part === actual;
  });
}
