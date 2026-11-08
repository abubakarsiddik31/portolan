import { describe, expect, it } from "vitest";

import type { Bounds, SemanticNode } from "./engine.js";
import { buildRefMap, findReplacement, hashRef, RefRegistry, resolveRef } from "./refs.js";

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
  node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1, bounds: rect() }),
  node({ nodeId: "2", role: "textbox", name: "Search", backendNodeId: 2, bounds: rect() }),
  node({ nodeId: "3", role: "link", name: "Home", backendNodeId: 3, bounds: rect() }),
];

describe("buildRefMap", () => {
  it("is deterministic", () => {
    const first = buildRefMap(NODES, 1);
    const second = buildRefMap(NODES, 1);

    expect([...first.byRef.keys()]).toEqual([...second.byRef.keys()]);
  });

  it("disambiguates same role and name by ordinal", () => {
    const map = buildRefMap(
      [
        node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 }),
        node({ nodeId: "2", role: "button", name: "Continue", backendNodeId: 2 }),
      ],
      1,
    );

    const refs = [...map.byRef.keys()];

    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
    expect(map.byNode.get("1")?.ordinal).toBe(0);
    expect(map.byNode.get("2")?.ordinal).toBe(1);
  });

  it("extends colliding refs until every ref is unique", () => {
    const nodes = Array.from({ length: 12 }, (_, index) =>
      node({
        nodeId: `n${index}`,
        role: "button",
        name: `B${index}`,
        backendNodeId: index + 1,
      }),
    );

    const map = buildRefMap(nodes, 1, { hash: () => 42 });
    const refs = [...map.byRef.keys()];

    expect(refs).toHaveLength(12);
    expect(new Set(refs).size).toBe(12);
    expect(refs.every((ref) => ref.startsWith("e"))).toBe(true);
    expect(refs.some((ref) => ref.length > 5)).toBe(true);
  });

  it("scopes every entry to the document", () => {
    const map = buildRefMap(NODES, 7);

    expect(map.doc).toBe(7);
    expect([...map.byRef.values()].every((entry) => entry.doc === 7)).toBe(true);
  });

  it("skips ignored nodes and nodes with no backend id", () => {
    const map = buildRefMap(
      [
        node({ nodeId: "1", role: "button", name: "Visible", backendNodeId: 1 }),
        node({
          nodeId: "2",
          role: "button",
          name: "Ignored",
          backendNodeId: 2,
          ignored: true,
        }),
        node({ nodeId: "3", role: "button", name: "No backend id" }),
      ],
      1,
    );

    expect(map.byRef.size).toBe(1);
  });
});

describe("resolveRef", () => {
  it("resolves a ref to its node", () => {
    const map = buildRefMap(NODES, 1);
    const ref = map.byNode.get("2")?.ref;

    expect(ref).toBeDefined();
    expect(resolveRef(map, ref as string)?.nodeId).toBe("2");
    expect(resolveRef(map, "enope")).toBeUndefined();
  });
});

describe("findReplacement", () => {
  it("finds a node by exact role and name", () => {
    const before = buildRefMap(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const previous = before.byNode.get("1");
    if (previous === undefined) throw new Error("missing previous node");

    const after = buildRefMap(
      [node({ nodeId: "9", role: "button", name: "Continue", backendNodeId: 9 })],
      2,
    );

    expect(findReplacement(previous, after)).toBe(after.byNode.get("9")?.ref);
  });

  it("falls back to a normalized name", () => {
    const before = buildRefMap(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const previous = before.byNode.get("1");
    if (previous === undefined) throw new Error("missing previous node");

    const after = buildRefMap(
      [node({ nodeId: "2", role: "button", name: "  continue ", backendNodeId: 2 })],
      2,
    );

    expect(resolveRef(after, previous.ref)).toBeUndefined();
    expect(findReplacement(previous, after)).toBe(after.byNode.get("2")?.ref);
  });

  it("returns undefined when the node is gone", () => {
    const before = buildRefMap(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const previous = before.byNode.get("1");
    if (previous === undefined) throw new Error("missing previous node");

    const after = buildRefMap(
      [node({ nodeId: "2", role: "link", name: "Continue", backendNodeId: 2 })],
      2,
    );

    expect(findReplacement(previous, after)).toBeUndefined();
  });
});

describe("RefRegistry", () => {
  it("keeps a ref stable when the node survives a re-render", () => {
    const registry = new RefRegistry();
    const before = registry.build(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const ref = before.byNode.get("1")?.ref;
    if (ref === undefined) throw new Error("missing ref");

    registry.build([node({ nodeId: "9", role: "button", name: "Continue", backendNodeId: 1 })], 2);

    expect(registry.resolve(ref)).toMatchObject({ ok: true });
  });

  it("reports a stale ref with a replacement", () => {
    const registry = new RefRegistry();
    const before = registry.build(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const ref = before.byNode.get("1")?.ref;
    if (ref === undefined) throw new Error("missing ref");

    registry.build([node({ nodeId: "2", role: "button", name: "Continue ", backendNodeId: 2 })], 2);

    const resolution = registry.resolve(ref);

    expect(resolution).toMatchObject({
      ok: false,
      code: "stale_ref",
      current_doc: 2,
    });
    if (resolution.ok) throw new Error("expected a stale ref");
    expect(resolution.new_ref).toBeDefined();
  });

  it("reports a stale ref with no replacement", () => {
    const registry = new RefRegistry();
    const before = registry.build(
      [node({ nodeId: "1", role: "button", name: "Continue", backendNodeId: 1 })],
      1,
    );
    const ref = before.byNode.get("1")?.ref;
    if (ref === undefined) throw new Error("missing ref");

    registry.build([node({ nodeId: "2", role: "button", name: "Next", backendNodeId: 2 })], 2);

    const resolution = registry.resolve(ref);

    expect(resolution).toMatchObject({
      ok: false,
      code: "stale_ref",
      current_doc: 2,
    });
    if (resolution.ok) throw new Error("expected a stale ref");
    expect(resolution.new_ref).toBeUndefined();
  });
});

describe("hashRef", () => {
  it("is deterministic and stays in the 32-bit range", () => {
    expect(hashRef("button|Continue|main|0")).toBe(hashRef("button|Continue|main|0"));
    expect(hashRef("a")).not.toBe(hashRef("b"));
    expect(hashRef("a")).toBeGreaterThanOrEqual(0);
    expect(hashRef("a")).toBeLessThan(2 ** 32);
  });
});
