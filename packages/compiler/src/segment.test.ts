import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelPort, ObjectResult, Usage } from "@portolan/model";
import { parseMap, type SiteMap } from "@portolan/protocol";
import type { Trace, TraceAct } from "@portolan/runtime";
import { describe, expect, it } from "vitest";

import { labelSegments, type SegmentLabel, segmentTrace } from "./segment.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function map(site: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, site, "v1.json"), "utf8"));
}

function act(input: {
  index: number;
  before: string;
  after: string;
  url: string;
  role?: string;
  name?: string;
  do?: TraceAct["do"];
}): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: `e${input.index}`,
    do: input.do ?? "click",
    locator: { role: input.role ?? "button", name: input.name ?? "Next", ordinal: 0 },
    doc: 1,
    v: input.index + 1,
    url: input.url,
    before_state: input.before,
    after_state: input.after,
    effects: [],
    delta: { navigation: false, entries: [] },
  };
}

function trace(entries: TraceAct[]): Trace {
  return {
    scope_id: "scope",
    sid: "sid",
    intent: "test",
    effect: "write",
    started_at: new Date(0).toISOString(),
    ended_at: new Date(1).toISOString(),
    entries,
  };
}

const USAGE: Usage = {
  input: 10,
  cached_input: 0,
  output: 5,
  provider: "fake",
  model: "fake",
};

function labelModel(labels: SegmentLabel[]): ModelPort {
  return {
    async object<T>(): Promise<ObjectResult<T>> {
      return { value: { segments: labels } as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the label model does not implement agent()");
    },
  };
}

describe("segmentTrace", () => {
  it("cuts the store flow at the oracle's op boundaries", () => {
    const acts = [
      act({ index: 0, before: "catalog", after: "catalog", url: "/", role: "textbox", do: "fill" }),
      act({ index: 1, before: "catalog", after: "results", url: "/search" }),
      act({ index: 2, before: "results", after: "product", url: "/p/p_101" }),
      act({
        index: 3,
        before: "product",
        after: "product",
        url: "/p/p_101",
        role: "combobox",
        do: "select",
      }),
      act({
        index: 4,
        before: "product",
        after: "product",
        url: "/p/p_101",
        role: "spinbutton",
        do: "fill",
      }),
      act({ index: 5, before: "product", after: "cart", url: "/cart" }),
      act({ index: 6, before: "cart", after: "checkout", url: "/checkout" }),
      act({ index: 7, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 8, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 9, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 10, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 11, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 12, before: "checkout", after: "checkout", url: "/checkout", role: "textbox" }),
      act({ index: 13, before: "checkout", after: "order", url: "/orders/ord_1001" }),
    ];

    const segments = segmentTrace(trace(acts), map("store"));
    expect(segments.map((segment) => segment.candidate)).toEqual([
      "search",
      "get_product",
      "add_to_cart",
      "open_checkout",
      "checkout",
    ]);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [2, 2],
      [3, 5],
      [6, 6],
      [7, 13],
    ]);
  });

  it("keeps a same-state filter as its own segment and leaves the op ambiguous", () => {
    const acts = [
      act({
        index: 0,
        before: "login",
        after: "login",
        url: "/login",
        role: "textbox",
        do: "fill",
      }),
      act({
        index: 1,
        before: "login",
        after: "login",
        url: "/login",
        role: "textbox",
        do: "fill",
      }),
      act({ index: 2, before: "login", after: "invoices", url: "/" }),
      act({ index: 3, before: "invoices", after: "invoices", url: "/", role: "combobox" }),
      act({ index: 4, before: "invoices", after: "invoices", url: "/?status=paid" }),
    ];

    const segments = segmentTrace(trace(acts), map("portal"));

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ candidate: "login", start: 0, end: 2 });
    expect(segments[1]).toMatchObject({ start: 3, end: 4 });
    expect(segments[1]?.candidate).toBeUndefined();
    expect(segments[1]?.reason).toContain("ambiguous");
  });

  it("merges the wizard's step changes into one op", () => {
    const acts = [
      act({
        index: 0,
        before: "step1",
        after: "step1",
        url: "/step/1",
        role: "textbox",
        do: "fill",
      }),
      act({ index: 1, before: "step1", after: "step2", url: "/step/2" }),
      act({
        index: 2,
        before: "step2",
        after: "step2",
        url: "/step/2",
        role: "textbox",
        do: "fill",
      }),
      act({ index: 3, before: "step2", after: "step3", url: "/step/3" }),
      act({
        index: 4,
        before: "step3",
        after: "step3",
        url: "/step/3",
        role: "textbox",
        do: "fill",
      }),
      act({ index: 5, before: "step3", after: "done", url: "/done/sub_1" }),
    ];

    const segments = segmentTrace(trace(acts), map("wizard"));

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ candidate: "submit_application", start: 0, end: 5 });
  });

  it("returns no segments for a trace with no acts", () => {
    expect(segmentTrace(trace([]), map("store"))).toEqual([]);
  });
});

describe("labelSegments", () => {
  it("asks the model once and returns one label per segment", async () => {
    const acts = [
      act({ index: 0, before: "catalog", after: "results", url: "/search" }),
      act({ index: 1, before: "results", after: "product", url: "/p/p_101" }),
    ];
    const segments = segmentTrace(trace(acts), map("store"));

    const result = await labelSegments({
      model: labelModel([
        { index: 0, action: "reuse", op: "search", reason: "matches" },
        { index: 1, action: "extend", op: "get_product", reason: "adds a filter" },
      ]),
      map: map("store"),
      segments,
    });

    expect(result.labels.map((label) => label.action)).toEqual(["reuse", "extend"]);
    expect(result.usage).toEqual(USAGE);
  });

  it("rejects a model that skips a segment", async () => {
    const acts = [act({ index: 0, before: "catalog", after: "results", url: "/search" })];
    const segments = segmentTrace(trace(acts), map("store"));

    await expect(
      labelSegments({
        model: labelModel([]),
        map: map("store"),
        segments,
      }),
    ).rejects.toThrow(/did not label segment 0/);
  });
});
