import type { TraceAct } from "@abubakarsiddiik/runtime";
import { describe, expect, it } from "vitest";

import type { ParameterizedSegment } from "./parameterize.js";
import type { InferredReturns } from "./returns.js";
import { liftUi } from "./ui.js";

const RETURNS: InferredReturns = {
  kind: "fields",
  extractor: { kind: "fields", fields: { submission_id: { test_id: "submission-id" } } },
  value: { submission_id: "sub_1" },
  schema: { type: "object", properties: { submission_id: { type: "string" } } },
};

function act(input: {
  index: number;
  do: TraceAct["do"];
  role: string;
  name: string;
  value?: string;
}): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: `e${input.index}`,
    do: input.do,
    locator: { role: input.role, name: input.name, ordinal: 0 },
    ...(input.value !== undefined ? { value: input.value } : {}),
    doc: 1,
    v: input.index + 1,
    url: "http://x/done",
    effects: [],
    delta: { navigation: false, entries: [] },
  };
}

function segment(actions: TraceAct[]): ParameterizedSegment {
  return {
    segment: {
      index: 0,
      start: 0,
      end: actions.length - 1,
      url: "http://x/done",
      actions,
      reason: "test",
    },
    op: "submit_application",
    params: [
      { name: "name", value: "Ada Lovelace", source: "label", action: 0 },
      { name: "file_path", value: "/tmp/sample.txt", source: "label", action: 1 },
    ],
    constants: [],
    missing: [],
    schema: {},
  };
}

describe("liftUi", () => {
  it("turns a trace into steps with param placeholders", () => {
    const lift = liftUi({
      segment: segment([
        act({ index: 0, do: "fill", role: "textbox", name: "Full name", value: "Ada Lovelace" }),
        act({ index: 1, do: "fill", role: "button", name: "Attachment", value: "/tmp/sample.txt" }),
        act({ index: 2, do: "check", role: "checkbox", name: "Confirm" }),
        act({ index: 3, do: "click", role: "button", name: "Submit application" }),
      ]),
      returns: RETURNS,
    });

    expect(lift?.steps).toEqual([
      { do: "fill", target: { role: "textbox", name: "Full name", ordinal: 0 }, value: "{name}" },
      {
        do: "fill",
        target: { role: "button", name: "Attachment", ordinal: 0 },
        value: "{file_path}",
      },
      { do: "check", target: { role: "checkbox", name: "Confirm", ordinal: 0 } },
      { do: "click", target: { role: "button", name: "Submit application", ordinal: 0 } },
    ]);
    expect(lift?.params.sort()).toEqual(["file_path", "name"]);
    expect(lift?.extract).toEqual(RETURNS.extractor);
  });

  it("keeps an unbound value as a constant", () => {
    const lift = liftUi({
      segment: segment([
        act({ index: 0, do: "fill", role: "textbox", name: "Note", value: "fixed" }),
      ]),
      returns: RETURNS,
    });

    expect(lift?.steps[0]).toMatchObject({ value: "fixed" });
    expect(lift?.params).toEqual([]);
  });

  it("skips an action with no locator", () => {
    const action = act({ index: 0, do: "click", role: "button", name: "Next" });
    const withoutLocator = { ...action, locator: undefined };

    expect(liftUi({ segment: segment([withoutLocator]), returns: RETURNS })).toBeUndefined();
  });
});
