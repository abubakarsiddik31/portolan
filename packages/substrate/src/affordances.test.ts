import { describe, expect, it } from "vitest";

import { estimateTokens, rankAffordances, renderAffordances } from "./affordances.js";
import type { Bounds, SemanticNode } from "./engine.js";
import { buildRefMap } from "./refs.js";

function rect(): Bounds {
  return { x: 0, y: 0, width: 10, height: 10 };
}

function node(
  partial: Partial<SemanticNode> & Pick<SemanticNode, "nodeId" | "role">,
): SemanticNode {
  return {
    nodeId: partial.nodeId,
    role: partial.role,
    name: partial.name ?? "",
    ignored: partial.ignored ?? false,
    visible: partial.visible ?? true,
    properties: partial.properties ?? {},
    childIds: partial.childIds ?? [],
    ...(partial.backendNodeId !== undefined ? { backendNodeId: partial.backendNodeId } : {}),
    ...(partial.bounds !== undefined ? { bounds: partial.bounds } : {}),
  };
}

const NODES: SemanticNode[] = [
  node({ nodeId: "1", role: "RootWebArea", name: "Test", childIds: ["2"] }),
  node({ nodeId: "2", role: "main", childIds: ["3", "6", "7"], bounds: rect() }),
  node({ nodeId: "3", role: "form", childIds: ["4", "5"], bounds: rect() }),
  node({ nodeId: "4", role: "textbox", name: "Search", backendNodeId: 104, bounds: rect() }),
  node({ nodeId: "5", role: "button", name: "Go", backendNodeId: 105, bounds: rect() }),
  node({ nodeId: "6", role: "link", name: "Home", backendNodeId: 106, bounds: rect() }),
  node({
    nodeId: "7",
    role: "button",
    name: "Hidden",
    backendNodeId: 107,
    visible: false,
    bounds: rect(),
  }),
  node({ nodeId: "8", role: "heading", name: "Title", backendNodeId: 108, bounds: rect() }),
  node({ nodeId: "9", role: "button", name: "No bounds", backendNodeId: 109 }),
];

describe("rankAffordances", () => {
  it("keeps only visible, actionable, measurable nodes", () => {
    const { affordances } = rankAffordances(NODES);

    expect(affordances.map((affordance) => affordance.name)).toEqual(["Go", "Search", "Home"]);
  });

  it("numbers duplicate role and name pairs", () => {
    const nodes = [
      node({ nodeId: "a", role: "button", name: "Add", backendNodeId: 201, bounds: rect() }),
      node({ nodeId: "b", role: "button", name: "Add", backendNodeId: 202, bounds: rect() }),
      node({ nodeId: "c", role: "button", name: "Other", backendNodeId: 203, bounds: rect() }),
    ];

    const { affordances } = rankAffordances(nodes);
    const adds = affordances.filter((affordance) => affordance.name === "Add");

    expect(adds.map((affordance) => affordance.ordinal)).toEqual([0, 1]);
  });

  it("ranks a button above a textbox and a link", () => {
    const { affordances } = rankAffordances(NODES);

    expect(affordances[0]?.role).toBe("button");
    expect(affordances[0]?.score).toBeGreaterThan(affordances[1]?.score ?? 0);
  });

  it("adds the nearest landmark as context", () => {
    const { affordances } = rankAffordances(NODES);
    const byName = new Map(affordances.map((affordance) => [affordance.name, affordance]));

    expect(byName.get("Go")?.ctx).toBe("form");
    expect(byName.get("Search")?.ctx).toBe("form");
    expect(byName.get("Home")?.ctx).toBe("main");
  });

  it("uses a named ancestor before a landmark", () => {
    const nodes = [
      node({ nodeId: "1", role: "main", childIds: ["2"], bounds: rect() }),
      node({
        nodeId: "2",
        role: "region",
        name: "Checkout",
        childIds: ["3"],
        bounds: rect(),
      }),
      node({
        nodeId: "3",
        role: "button",
        name: "Place order",
        backendNodeId: 3,
        bounds: rect(),
      }),
    ];

    const { affordances } = rankAffordances(nodes);

    expect(affordances[0]?.ctx).toBe('region "Checkout"');
  });

  it("caps the list and reports what it dropped", () => {
    const { affordances, omitted } = rankAffordances(NODES, { limit: 1 });

    expect(affordances).toHaveLength(1);
    expect(omitted).toBe(2);
  });
});

describe("renderAffordances", () => {
  const { affordances } = rankAffordances(NODES);

  it("renders every line under a generous budget", () => {
    const rendered = renderAffordances(affordances, { tokenBudget: 1000 });

    expect(rendered.included).toBe(3);
    expect(rendered.omitted).toBe(0);
    expect(rendered.text).toContain('button "Go" in form');
  });

  it("stops at the budget and reports the rest", () => {
    const rendered = renderAffordances(affordances, { tokenBudget: 5 });

    expect(rendered.included).toBe(1);
    expect(rendered.omitted).toBe(2);
    expect(rendered.tokens).toBeLessThanOrEqual(5);
  });
});

describe("estimateTokens", () => {
  it("counts four characters per token, rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("refs in affordances", () => {
  it("attaches a unique ref to every affordance", () => {
    const refs = buildRefMap(NODES, 1);
    const { affordances } = rankAffordances(NODES, { refs });

    expect(affordances.every((affordance) => affordance.ref !== undefined)).toBe(true);
    expect(new Set(affordances.map((affordance) => affordance.ref)).size).toBe(affordances.length);

    const rendered = renderAffordances(affordances);
    expect(rendered.text).toMatch(/^e[0-9a-z]+ button "Go"/);
  });
});
