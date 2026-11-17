import type { Trace } from "@abubakarsiddiik/runtime";
import { describe, expect, it } from "vitest";

import { generateFromSpec, generateFromTrace, slugify } from "./generate.js";

describe("generateFromSpec", () => {
  it("fills id, suite, routes, fixtures, and source defaults", () => {
    const { spec, warnings } = generateFromSpec({
      title: "Login flow",
      steps: [
        { goto: "/sign-in" },
        {
          do: "fill",
          target: { role: "textbox", name: "Email" },
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the value under test
          value: "${fixture.user.email}",
        },
        { do: "click", target: { role: "button", name: "Login" } },
      ],
      expect: [{ url: "/dashboard" }],
    });

    expect(spec.id).toBe("login-flow");
    expect(spec.suite).toBe("generated");
    expect(spec.status).toBe("draft");
    expect(spec.effect).toBe("read");
    expect(spec.routes).toEqual(["/sign-in"]);
    expect(spec.fixtures).toEqual(["user"]);
    expect(spec.source).toEqual({ kind: "generated" });
    expect(spec.tags).toEqual(["generated"]);
    expect(warnings).toEqual([
      'the steps write form fields but the case has no map, so it was classified "read"; attach a map and set effect "write" before promoting it',
    ]);
  });

  it("keeps explicit id, suite, tags, and routes", () => {
    const { spec } = generateFromSpec(
      {
        title: "Anything",
        steps: [{ goto: "/a" }],
        routes: ["/custom"],
        tags: ["smoke"],
      },
      { id: "auth/custom", suite: "smoke" },
    );

    expect(spec.id).toBe("auth/custom");
    expect(spec.suite).toBe("smoke");
    expect(spec.routes).toEqual(["/custom"]);
    expect(spec.tags).toEqual(["smoke"]);
  });

  it("classifies a mapped case as a write and warns for mapless writes", () => {
    const mapped = generateFromSpec({
      title: "Delete item",
      steps: [{ op: "delete_item", params: { id: 1 } }],
      map: { site: "shop", version: 3, op: "delete_item" },
    });
    expect(mapped.spec.effect).toBe("write");
    expect(mapped.warnings).toEqual([]);

    const mapless = generateFromSpec({
      title: "Delete item",
      steps: [{ do: "fill", target: { role: "textbox", name: "Notes" }, value: "x" }],
    });
    expect(mapless.spec.effect).toBe("read");
    expect(mapless.warnings[0]).toContain("attach a map");
  });

  it("refuses a write without a map when the author asks for one", () => {
    expect(() =>
      generateFromSpec({
        title: "Delete item",
        effect: "write",
        steps: [{ goto: "/items" }],
      }),
    ).toThrowError(/needs a map/);
  });

  it("refuses a missing title, an unusable id, and empty steps", () => {
    expect(() => generateFromSpec({ steps: [{ goto: "/a" }] })).toThrowError(/title/);
    expect(() =>
      generateFromSpec({ title: "A", steps: [{ goto: "/a" }] }, { id: "Not A Path" }),
    ).toThrowError(/not path-like/);
    expect(() => generateFromSpec({ title: "A", steps: [] })).toThrowError(/steps/);
  });

  it("wraps schema violations as spec errors", () => {
    expect(() =>
      generateFromSpec({ title: "A", steps: [{ do: "teleport", target: { role: "button" } }] }),
    ).toThrowError(/not valid/);
  });
});

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    scope_id: "scope-1",
    sid: "session-1",
    intent: "sign in and open the dashboard",
    effect: "write",
    started_at: "2026-11-17T00:00:00.000Z",
    entries: [],
    ...overrides,
  };
}

const noEffects: [] = [];
const delta = { navigation: false, entries: [] };

describe("generateFromTrace", () => {
  it("turns views and acts into goto and semantic steps", () => {
    const { spec, warnings } = generateFromTrace(
      trace({
        entries: [
          {
            kind: "view",
            at: "t0",
            doc: 1,
            v: 1,
            url: "http://app/sign-in",
            affordances: 5,
          },
          {
            kind: "act",
            at: "t1",
            ref: "r1",
            do: "fill",
            value: "a@b.test",
            locator: { role: "textbox", name: "Email", ordinal: 0 },
            doc: 1,
            v: 2,
            url: "http://app/sign-in",
            effects: noEffects,
            delta,
          },
          {
            kind: "act",
            at: "t2",
            ref: "r2",
            do: "click",
            locator: { role: "button", name: "Login", ordinal: 0 },
            doc: 1,
            v: 3,
            url: "http://app/dashboard",
            effects: [
              {
                kind: "navigation",
                from: "http://app/sign-in",
                to: "http://app/dashboard",
                doc: 2,
              },
            ],
            delta: { navigation: true, entries: [] },
          },
          { kind: "read", at: "t3", text: "Welcome" },
        ],
      }),
    );

    expect(spec.id).toBe("sign-in-and-open-the-dashboard");
    expect(spec.title).toBe("sign in and open the dashboard");
    expect(spec.steps).toEqual([
      { goto: "/sign-in" },
      { do: "fill", target: { role: "textbox", name: "Email" }, value: "a@b.test" },
      { do: "click", target: { role: "button", name: "Login" } },
    ]);
    expect(spec.routes).toEqual(["/sign-in"]);
    expect(spec.source).toEqual({ kind: "trace", trace_id: "scope-1" });
    expect(warnings).toEqual([
      'the trace was a "write" scope but the case has no map, so it was classified "read"; attach a map and set effect "write" before promoting it',
    ]);
  });

  it("replaces secret-looking fill values with env references", () => {
    const { spec, warnings } = generateFromTrace(
      trace({
        entries: [
          {
            kind: "act",
            at: "t1",
            ref: "r1",
            do: "fill",
            value: "hunter2",
            locator: { role: "textbox", name: "Password", ordinal: 0 },
            doc: 1,
            v: 2,
            url: "http://app/sign-in",
            effects: noEffects,
            delta,
          },
        ],
      }),
    );

    expect(spec.steps[0]).toEqual({
      do: "fill",
      target: { role: "textbox", name: "Password" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the value under test
      value: "${env.QA_PASSWORD}",
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the value under test
    expect(warnings[0]).toContain("${env.QA_PASSWORD}");
  });

  it("drops locator-less acts and counts them", () => {
    const { spec, warnings } = generateFromTrace(
      trace({
        entries: [
          {
            kind: "act",
            at: "t1",
            ref: "r9",
            do: "click",
            doc: 1,
            v: 2,
            url: "http://app/sign-in",
            effects: noEffects,
            delta,
          },
          {
            kind: "act",
            at: "t2",
            ref: "r2",
            do: "press",
            key: "Enter",
            doc: 1,
            v: 3,
            url: "http://app/sign-in",
            effects: noEffects,
            delta,
          },
        ],
      }),
    );

    expect(spec.steps).toEqual([{ do: "press", key: "Enter" }]);
    expect(warnings).toEqual([
      "1 recorded act(s) had no locator and were dropped",
      'the trace was a "write" scope but the case has no map, so it was classified "read"; attach a map and set effect "write" before promoting it',
    ]);
  });

  it("downgrades a writing trace without a map to read, with a warning", () => {
    const click = {
      kind: "act",
      at: "t1",
      ref: "r2",
      do: "click",
      locator: { role: "button", name: "Login", ordinal: 0 },
      doc: 1,
      v: 3,
      url: "http://app/dashboard",
      effects: noEffects,
      delta,
    } as const;

    const mapless = generateFromTrace(trace({ entries: [click as Trace["entries"][number]] }));
    expect(mapless.spec.effect).toBe("read");
    expect(mapless.warnings.some((line) => line.includes('"read"'))).toBe(true);

    const mapped = generateFromTrace(trace({ entries: [click as Trace["entries"][number]] }), {
      id: "auth/sign-in",
      map: { site: "app", version: 1, op: "sign_in" },
    });
    expect(mapped.spec.effect).toBe("write");
    expect(mapped.warnings).toEqual([]);
  });

  it("refuses a trace with no intent-derived steps", () => {
    expect(() => generateFromTrace(trace({ intent: "" }))).toThrowError(/title/);
    expect(() =>
      generateFromTrace(
        trace({
          entries: [{ kind: "read", at: "t0", text: "Welcome" }],
        }),
      ),
    ).toThrowError(/produced no steps/);
  });
});

describe("slugify", () => {
  it("makes path-like ids from prose", () => {
    expect(slugify("Login flow — happy path!")).toBe("login-flow-happy-path");
    expect(slugify("  Über flow  ")).toBe("uber-flow");
  });
});
