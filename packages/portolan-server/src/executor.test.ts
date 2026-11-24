import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import {
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { runtimeExecutor } from "./executor.js";

const MAP: SiteMap = {
  site: "test",
  origins: ["http://x"],
  version: 1,
  states: [
    { id: "home", marks: [{ role: "heading", name: "Home" }] },
    { id: "cart", marks: [{ role: "heading", name: "Cart" }] },
  ],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-09T00:00:00Z",
};

function node(name: string, role = "heading"): SemanticNode {
  return {
    nodeId: `${role}:${name}`,
    role,
    name,
    backendNodeId: 1,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
  };
}

function view(nodes: SemanticNode[], url = "http://x/"): SubstrateView {
  const snapshot: Snapshot = { doc: 1, v: 0, url, title: "", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

const HOME = view([node("Home"), node("Go", "button")]);
const WIDGET = view([node("Widget")], "http://x/item/1");

function op(overrides: Partial<OpDef>): OpDef {
  return {
    name: "op",
    version: 1,
    summary: "op",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: true },
    from: ["home"],
    to: ["home"],
    post: [],
    effect: "read",
    impls: [{ tier: "url", route: "/item/{id}", extract: { kind: "none" } }],
    status: "verified",
    ...overrides,
  };
}

function substrate(options: {
  initial?: SubstrateView;
  afterGoto?: SubstrateView;
  fetchJson?: unknown;
  actOk?: boolean;
}): Substrate {
  let current = options.initial ?? HOME;

  return {
    view: async () => current,
    state: () => current,
    goto: async () => {
      current = options.afterGoto ?? current;
      return current;
    },
    fetch: async () => ({ status: 200, text: "{}", json: options.fetchJson ?? {} }),
    act: async () =>
      options.actOk === false
        ? { ok: false, code: "invalid_request", message: "nope" }
        : { ok: true, effects: [] },
    read: async () => ({ text: "" }),
  } as unknown as Substrate;
}

const input = (target: OpDef, fake: Substrate | undefined) => ({
  session: { sid: "s", created_at: "t", last_used_at: "t" },
  map: MAP,
  op: target,
  params: { id: "1" },
  ...(fake !== undefined ? { substrate: fake } : {}),
});

const SESSION = { sid: "s", created_at: "t", last_used_at: "t" };

describe("runtimeExecutor", () => {
  it("runs a url read and reports the tier", async () => {
    const audits: unknown[] = [];
    const result = await runtimeExecutor()({
      ...input(op({}), substrate({ afterGoto: WIDGET })),
      audit: (info) => audits.push(info),
    });

    expect(result).toMatchObject({ ok: true, result: {} });
    expect(audits[0]).toMatchObject({ tier: "url" });
  });

  it("runs an http read", async () => {
    const result = await runtimeExecutor()(
      input(
        op({
          impls: [
            { tier: "http", steps: [{ method: "GET", url: "/api" }], extract: { kind: "json" } },
          ],
        }),
        substrate({ fetchJson: { id: "i1" } }),
      ),
    );

    expect(result).toMatchObject({ ok: true, result: { id: "i1" } });
  });

  it("runs a ui write from a valid state", async () => {
    const result = await runtimeExecutor()(
      input(
        op({
          effect: "write",
          impls: [
            {
              tier: "ui",
              steps: [{ do: "click", target: { role: "button", name: "Go" } }],
              extract: { kind: "none" },
            },
          ],
        }),
        substrate({ actOk: true }),
      ),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a write from the wrong state before dispatch", async () => {
    const result = await runtimeExecutor()(
      input(
        op({
          effect: "write",
          from: ["cart"],
          impls: [
            {
              tier: "ui",
              steps: [{ do: "click", target: { role: "button", name: "Go" } }],
              extract: { kind: "none" },
            },
          ],
        }),
        substrate({ actOk: true }),
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "precondition_failed", details: { current_state: "home" } },
    });
  });

  it("falls through to the next tier when the first fails", async () => {
    const result = await runtimeExecutor()(
      input(
        op({
          impls: [
            {
              tier: "url",
              route: "/missing/{id}",
              extract: { kind: "fields", fields: { title: { role: "heading", name: "Nope" } } },
            },
            {
              tier: "http",
              steps: [{ method: "GET", url: "/api" }],
              extract: { kind: "json" },
            },
          ],
        }),
        substrate({ afterGoto: view([], "http://x/missing/1"), fetchJson: { ok: true } }),
      ),
    );

    expect(result).toMatchObject({ ok: true, result: { ok: true } });
  });

  it("reports a missing substrate", async () => {
    const result = await runtimeExecutor()(input(op({}), undefined));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "op_broken", details: { stage: "executor" } },
    });
  });

  it("reports an op with only a webmcp impl", async () => {
    const result = await runtimeExecutor()(
      input(op({ impls: [{ tier: "webmcp", tool: "do" }] }), substrate({})),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "op_broken" } });
  });

  it("reports a map with no origin", async () => {
    const result = await runtimeExecutor()({
      ...input(op({}), substrate({})),
      map: { ...MAP, origins: [] },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "op_broken" } });
  });

  it("returns the last tier's error when every tier fails", async () => {
    const result = await runtimeExecutor()(
      input(
        op({
          impls: [
            {
              tier: "url",
              route: "/missing/{id}",
              extract: { kind: "fields", fields: { title: { role: "heading", name: "Nope" } } },
            },
          ],
        }),
        substrate({ afterGoto: view([], "http://x/missing/1") }),
      ),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "op_broken" } });
  });

  describe("without a page", () => {
    const HTTP = op({
      name: "list_keys",
      impls: [
        {
          tier: "http",
          steps: [{ method: "GET", url: "/api/keys" }],
          extract: { kind: "json", path: "" },
        },
      ],
    });

    function transport(response: { status: number; json?: unknown; error?: string }) {
      const calls: string[] = [];
      return {
        calls,
        fetch: async (request: { url: string }) => {
          calls.push(request.url);
          return { text: "", json: undefined, ...response };
        },
      };
    }

    it("serves an http op from the saved session and never opens a browser", async () => {
      const t = transport({ status: 200, json: { keys: [] } });
      let opened = 0;

      const result = await runtimeExecutor({ pageless: () => t })({
        session: SESSION,
        map: MAP,
        op: HTTP,
        params: {},
        getSubstrate: async () => {
          opened += 1;
          return undefined;
        },
      });

      expect(result).toEqual({ ok: true, result: { keys: [] } });
      expect(t.calls).toEqual(["http://x/api/keys"]);
      expect(opened).toBe(0);
    });

    it("falls back to a page when the saved session cannot authenticate", async () => {
      const t = transport({ status: 0, error: "no localStorage entry; sign in again" });
      let opened = 0;

      const result = await runtimeExecutor({ pageless: () => t })({
        session: SESSION,
        map: MAP,
        op: HTTP,
        params: {},
        getSubstrate: async () => {
          opened += 1;
          return substrate({ initial: HOME, fetchJson: { keys: ["a"] } });
        },
      });

      expect(opened).toBe(1);
      expect(result).toEqual({ ok: true, result: { keys: ["a"] } });
    });

    it("does not send a write again through a page after the site answered it", async () => {
      const t = transport({ status: 500, json: { detail: "boom" } });
      let opened = 0;

      const result = await runtimeExecutor({ pageless: () => t })({
        session: SESSION,
        map: MAP,
        op: { ...HTTP, effect: "write" },
        params: {},
        getSubstrate: async () => {
          opened += 1;
          return undefined;
        },
      });

      expect(opened).toBe(0);
      expect(result).toMatchObject({ ok: false, error: { code: "op_broken" } });
    });
  });
});
