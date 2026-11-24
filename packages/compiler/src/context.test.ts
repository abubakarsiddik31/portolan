import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";
import { describe, expect, it } from "vitest";

import { mergeContext, runContext, summaryFor } from "./context.js";

function act(overrides: Partial<TraceAct> = {}): TraceAct {
  return {
    kind: "act",
    at: new Date(0).toISOString(),
    ref: "e1",
    do: "click",
    locator: { role: "button", name: "Create key", ordinal: 0 },
    doc: 1,
    v: 1,
    url: "http://app.test/admin/orgs/org_123/api-keys",
    effects: [],
    delta: { navigation: false, entries: [] },
    ...overrides,
  };
}

const TRACE = {
  scope_id: "s1",
  sid: "x",
  intent: "Create an API key for an organization",
  effect: "write",
  started_at: new Date(0).toISOString(),
  entries: [],
} as Trace;

describe("runContext", () => {
  it("keeps the goal, the page, the control and what the run changed", () => {
    const context = runContext({
      trace: TRACE,
      actions: [
        act({
          effects: [
            {
              kind: "network",
              method: "POST",
              url: "http://api.test/api/orgs/org_123/keys",
              status: 201,
              resource_type: "Fetch",
            },
            {
              kind: "network",
              method: "GET",
              url: "http://app.test/static/app.js",
              status: 200,
              resource_type: "Script",
            },
          ],
          delta: {
            navigation: false,
            entries: [{ kind: "added", role: "status", name: "Key created" }],
          },
        }),
      ],
    });

    expect(context).toEqual({
      intent: "Create an API key for an organization",
      page: "/admin/orgs/{id}/api-keys",
      control: "Create key",
      observed: ["POST /api/orgs/{id}/keys -> 201", 'shows status "Key created"'],
    });
  });
});

describe("mergeContext", () => {
  it("lets the page structure say where, and the run say what happened", () => {
    expect(
      mergeContext(
        { page: "API keys", section: 'dialog "New key"', subject: "ci-prod" },
        { intent: "Make a key", page: "/api-keys", observed: ["POST /api/keys -> 201"] },
      ),
    ).toEqual({
      intent: "Make a key",
      page: "API keys",
      section: 'dialog "New key"',
      subject: "ci-prod",
      observed: ["POST /api/keys -> 201"],
    });
  });
});

describe("summaryFor", () => {
  it("replaces a bare 'Recorded' summary with the goal", () => {
    expect(summaryFor("Recorded: click Save.", { intent: "Rename the knowledge base" })).toBe(
      "Rename the knowledge base",
    );
  });

  it("says where the control is when there is no goal", () => {
    expect(
      summaryFor("Click Delete.", {
        control: "Delete",
        section: 'row "Danger zone"',
        subject: "ci-prod",
        page: "API keys",
      }),
    ).toBe('Click "Delete" in row "Danger zone" for ci-prod on API keys.');
  });

  it("leaves a summary that already says something", () => {
    expect(summaryFor("Rotate the signing key.", { intent: "x" })).toBe("Rotate the signing key.");
  });
});
