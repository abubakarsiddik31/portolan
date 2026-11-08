import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMap, type SiteMap } from "@portolan/protocol";
import type { Trace, TraceAct } from "@portolan/runtime";
import { describe, expect, it } from "vitest";

import { parameterizeTrace, parameterizeTraces } from "./parameterize.js";

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
  value?: string;
}): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: `e${input.index}`,
    do: input.do ?? "click",
    locator: { role: input.role ?? "button", name: input.name ?? "Next", ordinal: 0 },
    ...(input.value !== undefined ? { value: input.value } : {}),
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

describe("parameterizeTrace", () => {
  it("binds the add-to-cart signature from typed values and the product URL", () => {
    const acts = [
      act({
        index: 0,
        before: "product",
        after: "product",
        url: "/p/p_101",
        role: "combobox",
        name: "Size / color",
        do: "select",
        value: "v_101_m_blue",
      }),
      act({
        index: 1,
        before: "product",
        after: "product",
        url: "/p/p_101",
        role: "spinbutton",
        name: "Quantity",
        do: "fill",
        value: "1",
      }),
      act({ index: 2, before: "product", after: "cart", url: "/cart", name: "Add to cart" }),
    ];

    const result = parameterizeTrace({ trace: trace(acts) }, map("store"));
    const segment = result.segments[0];

    expect(segment?.op).toBe("add_to_cart");
    expect(segment?.params).toEqual([
      { name: "variant_id", value: "v_101_m_blue", source: "label", action: 0 },
      { name: "qty", value: 1, source: "label", action: 1 },
      { name: "product_id", value: "p_101", source: "url" },
    ]);
    expect(segment?.missing).toEqual([]);
  });

  it("binds every checkout field to the oracle signature", () => {
    const fields = [
      ["Full name", "Ada Lovelace"],
      ["Email", "ada@example.com"],
      ["Address", "1 Analytical Way"],
      ["City", "London"],
      ["Postal code", "N1 1AA"],
      ["Card number", "4242424242424242"],
    ] as const;

    const acts = fields.map(([name, value], index) =>
      act({
        index,
        before: "checkout",
        after: "checkout",
        url: "/checkout",
        role: "textbox",
        name,
        do: "fill",
        value,
      }),
    );
    acts.push(act({ index: 6, before: "checkout", after: "order", url: "/orders/ord_1" }));

    const result = parameterizeTrace({ trace: trace(acts) }, map("store"));
    const segment = result.segments[0];

    expect(segment?.op).toBe("checkout");
    expect(segment?.params.map((param) => param.name)).toEqual([
      "name",
      "email",
      "address",
      "city",
      "postal",
      "card",
    ]);
    expect(segment?.missing).toEqual([]);
  });

  it("uses a label to resolve the portal filter and binds status", () => {
    const acts = [
      act({
        index: 0,
        before: "invoices",
        after: "invoices",
        url: "/?status=paid",
        role: "combobox",
        name: "Status",
        do: "select",
        value: "paid",
      }),
    ];

    const result = parameterizeTrace(
      {
        trace: trace(acts),
        labels: [
          { index: 0, action: "reuse", op: "filter_invoices", reason: "the URL carries status" },
        ],
      },
      map("portal"),
    );

    expect(result.segments[0]?.op).toBe("filter_invoices");
    expect(result.segments[0]?.params).toEqual([
      { name: "status", value: "paid", source: "label", action: 0 },
    ]);
  });

  it("reports the wizard's missing file path", () => {
    const acts = [
      act({
        index: 0,
        before: "step1",
        after: "step1",
        url: "/step/1",
        role: "textbox",
        name: "Full name",
        do: "fill",
        value: "Ada Lovelace",
      }),
      act({
        index: 1,
        before: "step1",
        after: "step1",
        url: "/step/1",
        role: "textbox",
        name: "Email",
        do: "fill",
        value: "ada@example.com",
      }),
      act({
        index: 2,
        before: "step1",
        after: "step2",
        url: "/step/2",
        name: "Continue",
      }),
      act({
        index: 3,
        before: "step2",
        after: "step2",
        url: "/step/2",
        role: "textbox",
        name: "Company",
        do: "fill",
        value: "Analytical Engines",
      }),
      act({
        index: 4,
        before: "step2",
        after: "step2",
        url: "/step/2",
        role: "combobox",
        name: "Role",
        do: "select",
        value: "Engineer",
      }),
      act({
        index: 5,
        before: "step2",
        after: "step2",
        url: "/step/2",
        role: "spinbutton",
        name: "Team size",
        do: "fill",
        value: "12",
      }),
      act({ index: 6, before: "step2", after: "step3", url: "/step/3", name: "Continue" }),
      act({ index: 7, before: "step3", after: "done", url: "/done/sub_1", name: "Submit" }),
    ];

    const result = parameterizeTrace({ trace: trace(acts) }, map("wizard"));
    const segment = result.segments[0];

    expect(segment?.op).toBe("submit_application");
    expect(segment?.params.map((param) => param.name)).toEqual([
      "name",
      "email",
      "company",
      "role",
      "team_size",
    ]);
    expect(segment?.missing).toEqual(["file_path"]);
  });
});

describe("parameterizeTraces", () => {
  it("promotes a constant to a param when it changes between traces", () => {
    const first = trace([
      act({
        index: 0,
        before: "cart",
        after: "cart",
        url: "/cart",
        role: "textbox",
        name: "Note",
        do: "fill",
        value: "first",
      }),
      act({ index: 1, before: "cart", after: "checkout", url: "/checkout" }),
    ]);
    const second = trace([
      act({
        index: 0,
        before: "cart",
        after: "cart",
        url: "/cart",
        role: "textbox",
        name: "Note",
        do: "fill",
        value: "second",
      }),
      act({ index: 1, before: "cart", after: "checkout", url: "/checkout" }),
    ]);

    const results = parameterizeTraces([{ trace: first }, { trace: second }], map("store"));

    const note = results[0]?.segments[0]?.params.find((param) => param.name === "note");
    expect(note).toMatchObject({ value: "first", source: "varying", varying: true });
    expect(results[1]?.segments[0]?.params.find((param) => param.name === "note")).toMatchObject({
      value: "second",
      source: "varying",
      varying: true,
    });
  });
});
