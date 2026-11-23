import type { SiteMap } from "@abubakarsiddiik/protocol";
import type { TraceAct } from "@abubakarsiddiik/runtime";
import type { Delta, Effect } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { inferPost } from "./post.js";

const MAP = {
  site: "app",
  origins: ["http://app.test"],
  version: 1,
  states: [{ id: "dashboard", marks: [] }],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-17T00:00:00.000Z",
} as unknown as SiteMap;

function act(input: {
  effects?: Effect[];
  delta?: Delta;
  before?: string;
  after?: string;
}): TraceAct {
  return {
    kind: "act",
    at: "2026-11-17T00:00:00.000Z",
    ref: "e1",
    do: "click",
    locator: { role: "button", name: "30 days", ordinal: 0 },
    doc: 1,
    v: 1,
    url: "http://app.test/analytics?range=30d",
    effects: input.effects ?? [],
    delta: input.delta ?? { navigation: false, entries: [] },
    ...(input.before !== undefined ? { before_state: input.before } : {}),
    ...(input.after !== undefined ? { after_state: input.after } : {}),
  };
}

const nav = (from: string, to: string): Effect => ({ kind: "navigation", from, to, doc: 1 });

describe("inferPost", () => {
  it("proposes a url check from a query that changed", () => {
    const [check] = inferPost(
      [act({ effects: [nav("http://app.test/analytics", "http://app.test/analytics?range=30d")] })],
      MAP,
    );

    expect(check).toEqual({
      kind: "url",
      pattern: "^/analytics$",
      search: "(^|&)range=30d(&|$)",
    });
    expect(
      new RegExp(check?.kind === "url" ? (check.search ?? "") : "").test("a=1&range=30d"),
    ).toBe(true);
    expect(new RegExp(check?.kind === "url" ? (check.search ?? "") : "").test("range=7d")).toBe(
      false,
    );
  });

  it("matches any id when the path moved to a detail page", () => {
    const [check] = inferPost(
      [act({ effects: [nav("http://app.test/orgs", "http://app.test/orgs/42")] })],
      MAP,
    );
    expect(check).toEqual({ kind: "url", pattern: "^/orgs/[^/]+$" });
  });

  it("proposes a state the map names, and a dialog that appeared", () => {
    expect(inferPost([act({ before: "home", after: "dashboard" })], MAP)).toEqual([
      { kind: "state", state: "dashboard" },
    ]);
    expect(inferPost([act({ before: "home", after: "elsewhere" })], MAP)).toEqual([]);

    const checks = inferPost(
      [
        act({
          delta: {
            navigation: false,
            entries: [{ kind: "added", role: "dialog", name: "New API Key" }],
          },
        }),
      ],
      MAP,
    );
    expect(checks).toEqual([{ kind: "exists", locator: { role: "dialog", name: "New API Key" } }]);
  });

  it("proposes nothing when the click changed nothing it can name", () => {
    expect(inferPost([act({})], MAP)).toEqual([]);
    expect(
      inferPost([act({ effects: [nav("http://app.test/a?x=1", "http://app.test/a?x=1")] })], MAP),
    ).toEqual([]);
  });
});
