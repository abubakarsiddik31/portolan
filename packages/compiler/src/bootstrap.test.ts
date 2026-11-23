import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";
import type { Effect } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { bootstrapFromTraces, labelTraces, nameFromSegment } from "./bootstrap.js";

const AT = "2026-11-17T00:00:00.000Z";
const DELTA = { navigation: false, entries: [] };

function act(input: {
  do: TraceAct["do"];
  ref: string;
  value?: string;
  key?: string;
  name: string;
  role: string;
  v: number;
  url: string;
  effects?: Effect[];
}): TraceAct {
  return {
    kind: "act",
    at: AT,
    ref: input.ref,
    do: input.do,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.key !== undefined ? { key: input.key } : {}),
    locator: { role: input.role, name: input.name, ordinal: 0 },
    doc: 1,
    v: input.v,
    url: input.url,
    effects: input.effects ?? [],
    delta: DELTA,
  };
}

function trace(entries: TraceAct[]): Trace {
  return {
    scope_id: "run-1",
    sid: "sid-1",
    intent: "a recorded run",
    effect: "read",
    started_at: AT,
    ended_at: AT,
    entries,
  };
}

const search = trace([
  act({
    do: "fill",
    ref: "e1",
    value: "compilers",
    name: "Search books",
    role: "textbox",
    v: 1,
    url: "http://app.example/search?q=compilers",
  }),
  act({
    do: "click",
    ref: "e2",
    name: "Search",
    role: "button",
    v: 2,
    url: "http://app.example/search?q=compilers",
  }),
]);

const signIn = trace([
  act({
    do: "fill",
    ref: "e1",
    value: "agent@example.com",
    name: "Email",
    role: "textbox",
    v: 1,
    url: "http://app.example/login",
  }),
  act({
    do: "click",
    ref: "e2",
    name: "Sign in",
    role: "button",
    v: 2,
    url: "http://app.example/dashboard",
    effects: [
      {
        kind: "network",
        method: "POST",
        url: "http://app.example/api/login",
        status: 200,
        request_body: { email: "agent@example.com" },
        response_body: { ok: true },
      },
    ],
  }),
]);

function bootstrapMapForTest() {
  return {
    site: "library",
    origins: ["http://app.example"],
    version: 0,
    states: [{ id: "unknown", marks: [] }],
    ops: [],
    entities: {},
    compiled_from: [],
    verified_at: AT,
  };
}

describe("bootstrapFromTraces", () => {
  it("names and compiles a run with no base map", async () => {
    const result = await bootstrapFromTraces({
      site: "library",
      origins: ["http://app.example"],
      traces: [search],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      tier: "url",
      op: { name: "search", effect: "read", status: "verified" },
    });
    expect(result.map.ops.map((op) => op.name)).toEqual(["search"]);
    expect(result.map.states.map((state) => state.id)).toEqual(["root"]);
  });

  it("compiles a write with no outcome check to a ui op, not http", async () => {
    const result = await bootstrapFromTraces({
      site: "support",
      origins: ["http://app.example"],
      traces: [signIn],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.tier).toBe("ui");
    expect(result.candidates[0]?.op).toMatchObject({ name: "sign_in", effect: "write" });
    expect(result.candidates[0]?.op.outcome_check).toBeUndefined();
  });

  it("names a write after the click that made it, not the last click", () => {
    const create = trace([
      act({
        do: "click",
        ref: "e1",
        name: "Create",
        role: "button",
        v: 1,
        url: "http://app.example/keys",
        effects: [
          {
            kind: "network",
            method: "POST",
            url: "http://app.example/api/keys",
            status: 200,
            request_body: { name: "k" },
            response_body: { id: 1 },
          },
        ],
      }),
      act({
        do: "click",
        ref: "e2",
        name: "Done",
        role: "button",
        v: 2,
        url: "http://app.example/keys",
      }),
    ]);

    expect(labelTraces([create], bootstrapMapForTest())[0]?.[0]?.name).toBe("create");
  });

  it("keeps a write as http when it has an outcome check", async () => {
    const kept = await bootstrapFromTraces({
      site: "support",
      origins: ["http://app.example"],
      traces: [signIn],
      outcomeChecks: { sign_in: "whoami" },
    });

    expect(kept.candidates).toHaveLength(1);
    expect(kept.candidates[0]?.tier).toBe("http");
    expect(kept.candidates[0]?.op).toMatchObject({
      name: "sign_in",
      effect: "write",
      outcome_check: "whoami",
    });
  });

  it("produces a distinct name per segment across traces", () => {
    const labels = labelTraces([search, search], {
      site: "library",
      origins: ["http://app.example"],
      version: 0,
      states: [{ id: "unknown", marks: [] }],
      ops: [],
      entities: {},
      compiled_from: [],
      verified_at: AT,
    });

    expect(labels[0]?.[0]?.name).toBe("search");
    expect(labels[1]?.[0]?.name).toBe("search_2");
  });

  it("prefers a button label over a field label", () => {
    expect(
      nameFromSegment({
        index: 0,
        start: 0,
        end: 1,
        actions: signIn.entries as TraceAct[],
        reason: "last act",
      }),
    ).toBe("sign_in");
  });
});
