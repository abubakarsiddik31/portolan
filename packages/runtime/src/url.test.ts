import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import {
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";
import { describe, expect, it, vi } from "vitest";

import { runUrlOp } from "./url.js";

const MAP: SiteMap = {
  site: "test",
  origins: ["http://x"],
  version: 1,
  states: [],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-08T00:00:00Z",
};

function op(overrides: Partial<OpDef> = {}): OpDef {
  return {
    name: "get",
    version: 1,
    summary: "get",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
    from: [],
    to: [],
    post: [],
    effect: "read",
    impls: [
      {
        tier: "url",
        route: "/item/{id}",
        extract: { kind: "fields", fields: { title: { role: "heading" } } },
      },
    ],
    status: "verified",
    ...overrides,
  };
}

function node(partial: Partial<SemanticNode> & Pick<SemanticNode, "role">): SemanticNode {
  return {
    nodeId: partial.nodeId ?? `${partial.role}:${partial.name ?? ""}`,
    role: partial.role,
    name: partial.name ?? "",
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
    ...(partial.backendNodeId !== undefined ? { backendNodeId: partial.backendNodeId } : {}),
  };
}

function view(url: string, nodes: SemanticNode[]): SubstrateView {
  const snapshot: Snapshot = { doc: 1, v: 0, url, title: "", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

function substrate(result: SubstrateView): {
  substrate: Substrate;
  goto: ReturnType<typeof vi.fn>;
} {
  const goto = vi.fn(async () => result);
  return { substrate: { goto } as unknown as Substrate, goto };
}

describe("runUrlOp", () => {
  it("navigates, checks postconditions, and extracts the result", async () => {
    const { substrate: fake, goto } = substrate(
      view("http://x/item/a%20b", [node({ role: "heading", name: "Widget" })]),
    );

    const result = await runUrlOp({
      map: MAP,
      op: op(),
      params: { id: "a b" },
      substrate: fake,
    });

    expect(result).toMatchObject({ ok: true, result: { title: "Widget" } });
    expect(goto).toHaveBeenCalledWith("http://x/item/a%20b", { settle: false });
  });

  it("refuses a write op", async () => {
    const { substrate: fake } = substrate(view("http://x/", []));

    const result = await runUrlOp({
      map: MAP,
      op: op({ effect: "write" }),
      params: { id: "1" },
      substrate: fake,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("refuses an op with no url impl", async () => {
    const { substrate: fake } = substrate(view("http://x/", []));
    const ui: OpDef = op({
      impls: [
        {
          tier: "ui",
          steps: [{ do: "click", target: { role: "button", name: "Go" } }],
          extract: { kind: "none" },
        },
      ],
    });

    expect(
      await runUrlOp({ map: MAP, op: ui, params: { id: "1" }, substrate: fake }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("reports a missing route param", async () => {
    const { substrate: fake } = substrate(view("http://x/", []));

    expect(await runUrlOp({ map: MAP, op: op(), params: {}, substrate: fake })).toMatchObject({
      ok: false,
      code: "invalid_params",
    });
  });

  it("reports a map with no origin", async () => {
    const { substrate: fake } = substrate(view("http://x/", []));

    expect(
      await runUrlOp({
        map: { ...MAP, origins: [] },
        op: op(),
        params: { id: "1" },
        substrate: fake,
      }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("fails a postcondition", async () => {
    const { substrate: fake } = substrate(view("http://x/other", []));

    expect(
      await runUrlOp({
        map: MAP,
        op: op({ post: [{ kind: "url", pattern: "^/item/" }] }),
        params: { id: "1" },
        substrate: fake,
      }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("fails when the extractor finds nothing", async () => {
    const { substrate: fake } = substrate(view("http://x/item/1", []));

    expect(
      await runUrlOp({ map: MAP, op: op(), params: { id: "1" }, substrate: fake }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("fails when the result does not match the returns schema", async () => {
    const { substrate: fake } = substrate(
      view("http://x/item/1", [node({ role: "heading", name: "Widget" })]),
    );
    const wrong = op({
      returns: {
        type: "object",
        properties: { title: { type: "number" } },
        required: ["title"],
        additionalProperties: false,
      },
    });

    expect(
      await runUrlOp({ map: MAP, op: wrong, params: { id: "1" }, substrate: fake }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });
});
