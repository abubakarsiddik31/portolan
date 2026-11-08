import type { OpDef, SiteMap } from "@portolan/protocol";
import {
  type ActResult,
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type Substrate,
  type SubstrateView,
} from "@portolan/substrate";
import { describe, expect, it, vi } from "vitest";

import { runUiOp } from "./ui.js";

const MAP: SiteMap = {
  site: "test",
  origins: ["http://x"],
  version: 1,
  states: [{ id: "home", marks: [] }],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-08T00:00:00Z",
};

function op(overrides: Partial<OpDef> = {}): OpDef {
  return {
    name: "go",
    version: 1,
    summary: "go",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: false },
    from: ["home"],
    to: ["home"],
    post: [],
    effect: "write",
    impls: [
      {
        tier: "ui",
        steps: [
          { do: "click", target: { role: "button", name: "Go" } },
          { do: "await_state", state: "home" },
        ],
        extract: { kind: "none" },
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
    backendNodeId: partial.backendNodeId ?? 1,
  };
}

function view(nodes: SemanticNode[]): SubstrateView {
  const snapshot: Snapshot = { doc: 1, v: 0, url: "http://x/", title: "", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

const BUTTON = view([node({ role: "button", name: "Go" })]);
const TEXTBOX = view([node({ role: "textbox", name: "Name", backendNodeId: 2 })]);

function fake(options: { result?: ActResult; initial?: SubstrateView } = {}): {
  substrate: Substrate;
  act: ReturnType<typeof vi.fn>;
} {
  let current = options.initial ?? BUTTON;
  const act = vi.fn(async (_request: unknown) => options.result ?? { ok: true, effects: [] });

  const substrate = {
    view: async () => current,
    state: () => current,
    act: async (request: unknown) => {
      const result = await act(request);
      if (result.ok) current = options.initial ?? BUTTON;
      return result;
    },
  } as unknown as Substrate;

  return { substrate, act };
}

const OK_ACT: ActResult = {
  ok: true,
  doc: 1,
  v: 1,
  url: "http://x/",
  title: "",
  effects: [],
  delta: { navigation: false, entries: [] },
};

describe("runUiOp", () => {
  it("resolves a locator, acts, and awaits the next state", async () => {
    const { substrate, act } = fake({ result: OK_ACT });

    const result = await runUiOp({ map: MAP, op: op(), params: {}, substrate });

    expect(result).toMatchObject({ ok: true });
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({ ref: expect.any(String), do: "click" }),
    );
  });

  it("refuses an op whose from state does not match", async () => {
    const { substrate } = fake({ result: OK_ACT });

    const result = await runUiOp({
      map: MAP,
      op: op({ from: ["other"] }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "precondition_failed", current_state: "home" });
  });

  it("reports a locator that does not resolve", async () => {
    const { substrate } = fake({ result: OK_ACT });

    const result = await runUiOp({
      map: MAP,
      op: op({
        impls: [
          {
            tier: "ui",
            steps: [{ do: "click", target: { role: "button", name: "Missing" } }],
            extract: { kind: "none" },
          },
        ],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken", details: { locator: {} } });
  });

  it("reports a fill whose value template has no param", async () => {
    const { substrate } = fake({ result: OK_ACT, initial: TEXTBOX });

    const result = await runUiOp({
      map: MAP,
      op: op({
        impls: [
          {
            tier: "ui",
            steps: [{ do: "fill", target: { role: "textbox", name: "Name" }, value: "{name}" }],
            extract: { kind: "none" },
          },
        ],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_params" });
  });

  it("maps a stale ref to op_broken", async () => {
    const { substrate } = fake({
      result: { ok: false, code: "stale_ref", current_doc: 1, new_ref: "e2" },
    });

    const result = await runUiOp({ map: MAP, op: op(), params: {}, substrate });

    expect(result).toMatchObject({ ok: false, code: "op_broken", details: { new_ref: "e2" } });
  });

  it("maps a covered target to op_broken", async () => {
    const { substrate } = fake({
      result: {
        ok: false,
        code: "not_interactive",
        blocker_backend_node_id: 3,
        blocker_ref: "e3",
      },
    });

    const result = await runUiOp({ map: MAP, op: op(), params: {}, substrate });

    expect(result).toMatchObject({ ok: false, code: "op_broken", details: { blocker_ref: "e3" } });
  });

  it("maps an invalid act to invalid_params", async () => {
    const { substrate } = fake({
      result: { ok: false, code: "invalid_request", message: "bad value" },
    });

    const result = await runUiOp({ map: MAP, op: op(), params: {}, substrate });

    expect(result).toMatchObject({ ok: false, code: "invalid_params" });
  });

  it("fails an await_state that finds another state", async () => {
    const { substrate } = fake({ result: OK_ACT });

    const result = await runUiOp({
      map: MAP,
      op: op({
        impls: [
          {
            tier: "ui",
            steps: [{ do: "await_state", state: "checkout" }],
            extract: { kind: "none" },
          },
        ],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("refuses a press step", async () => {
    const { substrate } = fake({ result: OK_ACT });

    const result = await runUiOp({
      map: MAP,
      op: op({
        impls: [{ tier: "ui", steps: [{ do: "press", key: "Enter" }], extract: { kind: "none" } }],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("fails when the extractor finds nothing", async () => {
    const { substrate } = fake({ result: OK_ACT });

    const result = await runUiOp({
      map: MAP,
      op: op({
        impls: [
          {
            tier: "ui",
            steps: [{ do: "click", target: { role: "button", name: "Go" } }],
            extract: { kind: "fields", fields: { name: { role: "heading" } } },
          },
        ],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("fails when the extracted value does not match the returns schema", async () => {
    const { substrate } = fake({
      result: OK_ACT,
      initial: view([
        node({ role: "button", name: "Go" }),
        node({ role: "heading", name: "Title", backendNodeId: 4 }),
      ]),
    });

    const result = await runUiOp({
      map: MAP,
      op: op({
        returns: {
          type: "object",
          properties: { title: { type: "number" } },
          required: ["title"],
          additionalProperties: false,
        },
        impls: [
          {
            tier: "ui",
            steps: [{ do: "click", target: { role: "button", name: "Go" } }],
            extract: { kind: "fields", fields: { title: { role: "heading" } } },
          },
        ],
      }),
      params: {},
      substrate,
    });

    expect(result).toMatchObject({ ok: false, code: "op_broken" });
  });
});
