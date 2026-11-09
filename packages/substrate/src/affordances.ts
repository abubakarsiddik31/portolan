import type { Bounds, SemanticNode } from "./engine.js";
import type { RefMap } from "./refs.js";

export type Affordance = {
  /** Document-scoped handle, when a ref map was supplied. */
  ref?: string;
  /** CDP backend node id; stable within one document. */
  backendNodeId: number;
  role: string;
  name: string;
  /** Zero-based position among affordances with the same role and name. */
  ordinal: number;
  /** Nearest named ancestor or landmark, for disambiguation. */
  ctx?: string;
  bounds: Bounds;
  properties: Record<string, string | number | boolean>;
  /** Ranking weight; higher is more useful to an agent. */
  score: number;
};

export type RankOptions = {
  /** Maximum number of affordances. Default 60. */
  limit?: number;
  /** Attach a ref from this document's map. */
  refs?: RefMap;
};

export type RankedAffordances = {
  affordances: Affordance[];
  omitted: number;
};

export type RenderOptions = {
  /** Estimated token budget. Default 800. */
  tokenBudget?: number;
};

export type RenderedAffordances = {
  text: string;
  tokens: number;
  included: number;
  omitted: number;
};

/** Roles an agent can act on. Structure roles are not affordances. */
const ACTIONABLE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "gridcell",
]);

const ROLE_WEIGHT: Record<string, number> = {
  button: 10,
  link: 9,
  textbox: 9,
  searchbox: 9,
  combobox: 8,
  checkbox: 8,
  radio: 8,
  switch: 8,
  spinbutton: 8,
  slider: 7,
  tab: 7,
  menuitem: 7,
  option: 6,
  treeitem: 6,
  gridcell: 5,
};

const LANDMARK_ROLES = new Set([
  "main",
  "form",
  "region",
  "dialog",
  "navigation",
  "table",
  "article",
  "list",
  "listitem",
  "tabpanel",
  "search",
  "complementary",
  "banner",
  "contentinfo",
]);

/** Their names are page titles or nothing useful as context. */
const STRUCTURAL_ROLES = new Set(["RootWebArea", "WebArea", "document", "generic"]);

/**
 * Filter, rank, and cap the actionable nodes in a semantic capture.
 *
 * Ranking is deliberately simple and deterministic: role weight, then a
 * name, then context, then document order. The point is a stable short list,
 * not a model's opinion.
 */
export function rankAffordances(
  nodes: SemanticNode[],
  options: RankOptions = {},
): RankedAffordances {
  const limit = options.limit ?? 60;
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const parents = buildParents(nodes);
  const order = new Map(nodes.map((node, index) => [node.nodeId, index]));

  const candidates: Array<{ affordance: Affordance; index: number }> = [];

  for (const node of nodes) {
    if (!isActionable(node)) continue;

    const ctx = contextFor(node, byId, parents);
    const affordance: Affordance = {
      backendNodeId: node.backendNodeId as number,
      role: node.role,
      name: node.name,
      ordinal: 0,
      bounds: node.bounds as Bounds,
      properties: node.properties,
      score: weightOf(node, ctx),
    };

    if (ctx !== undefined) affordance.ctx = ctx;

    const ref = options.refs?.byNode.get(node.nodeId)?.ref;
    if (ref !== undefined) affordance.ref = ref;

    candidates.push({ affordance, index: order.get(node.nodeId) ?? 0 });
  }

  candidates.sort((a, b) => b.affordance.score - a.affordance.score || a.index - b.index);

  const selected = candidates.slice(0, limit).map((candidate) => candidate.affordance);

  // Duplicate names are common (six "Add application" buttons, several
  // "Continue" links). An ordinal lets a caller name the one it means.
  const seen = new Map<string, number>();
  for (const affordance of selected) {
    const key = `${affordance.role}\u0000${affordance.name}`;
    const ordinal = seen.get(key) ?? 0;
    affordance.ordinal = ordinal;
    seen.set(key, ordinal + 1);
  }

  return {
    affordances: selected,
    omitted: candidates.length - selected.length,
  };
}

/**
 * Render affordances as compact lines under a token budget.
 *
 * The estimate is four characters per token, which is good enough for a
 * budget check and avoids a tokenizer in the hot path. Refs are not in the
 * text yet; T2.12 adds them.
 */
export function renderAffordances(
  affordances: Affordance[],
  options: RenderOptions = {},
): RenderedAffordances {
  const budget = options.tokenBudget ?? 800;
  const lines: string[] = [];
  let tokens = 0;

  for (const affordance of affordances) {
    const line = formatAffordance(affordance);
    const cost = estimateTokens(line);

    if (lines.length > 0 && tokens + cost > budget) break;

    lines.push(line);
    tokens += cost;
  }

  return {
    text: lines.join("\n"),
    tokens,
    included: lines.length,
    omitted: affordances.length - lines.length,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isActionable(node: SemanticNode): boolean {
  return (
    node.visible &&
    node.backendNodeId !== undefined &&
    node.bounds !== undefined &&
    ACTIONABLE_ROLES.has(node.role)
  );
}

function buildParents(nodes: SemanticNode[]): Map<string, string> {
  const parents = new Map<string, string>();

  for (const node of nodes) {
    for (const childId of node.childIds) {
      parents.set(childId, node.nodeId);
    }
  }

  return parents;
}

function contextFor(
  node: SemanticNode,
  byId: Map<string, SemanticNode>,
  parents: Map<string, string>,
): string | undefined {
  let current = parents.get(node.nodeId);
  let depth = 0;
  let landmark: string | undefined;

  while (current !== undefined && depth < 8) {
    const ancestor = byId.get(current);
    if (ancestor === undefined) break;

    if (ancestor.name.length > 0 && !STRUCTURAL_ROLES.has(ancestor.role)) {
      return `${ancestor.role} ${JSON.stringify(ancestor.name)}`;
    }

    if (landmark === undefined && LANDMARK_ROLES.has(ancestor.role)) {
      landmark = ancestor.role;
    }

    current = parents.get(current);
    depth += 1;
  }

  return landmark;
}

function weightOf(node: SemanticNode, ctx: string | undefined): number {
  let weight = ROLE_WEIGHT[node.role] ?? 1;
  if (node.name.length > 0) weight += 3;
  if (ctx !== undefined) weight += 1;
  return weight;
}

function formatAffordance(affordance: Affordance): string {
  const ref = affordance.ref !== undefined ? `${affordance.ref} ` : "";
  const name = affordance.name.length > 0 ? JSON.stringify(affordance.name) : "(unnamed)";
  const ctx = affordance.ctx !== undefined ? ` in ${affordance.ctx}` : "";
  return `${ref}${affordance.role} ${name}${ctx}`;
}
