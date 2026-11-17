import type { SemanticNode } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { applyRepair, findReplacement, similarity } from "./repair.js";
import { parseCase, type QaCase } from "./spec.js";

function node(id: number, role: string, name: string): SemanticNode {
  return {
    nodeId: `n${id}`,
    role,
    name,
    backendNodeId: id,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
  };
}

const BUTTON_LOGIN = { role: "button", name: "Login" };

function caseSpec(overrides: Record<string, unknown> = {}): QaCase {
  return parseCase({
    schema: 1,
    id: "auth/login",
    title: "Login",
    suite: "smoke",
    effect: "read",
    status: "draft",
    tags: [],
    touches: [],
    routes: [],
    setup: [{ do: "click", target: { role: "button", name: "Menu" } }],
    steps: [
      { goto: "/sign-in" },
      { do: "fill", target: { role: "textbox", name: "Email" }, value: "a@b.test" },
      { do: "click", target: BUTTON_LOGIN },
    ],
    expect: [{ visible: { role: "button", name: "Login" } }],
    ...overrides,
  });
}

describe("similarity", () => {
  it("scores identity, truncation, and semantic rewrites apart", () => {
    expect(similarity("Login", "Login")).toBe(1);
    expect(similarity("Email address", "Email")).toBeGreaterThanOrEqual(0.9);
    expect(similarity("Login", "Login now")).toBeGreaterThanOrEqual(0.9);
    expect(similarity("Login", "Sign in")).toBeLessThan(0.6);
    expect(similarity("Email", "Password")).toBeLessThan(0.6);
  });
});

describe("findReplacement", () => {
  it("reports a locator that resolves again as transient", () => {
    const outcome = findReplacement([node(1, "button", "Login")], BUTTON_LOGIN);
    expect(outcome.status).toBe("resolves");
  });

  it("recovers a renamed target by best name match", () => {
    const outcome = findReplacement(
      [node(1, "button", "Continue with Google"), node(2, "button", "Login now")],
      BUTTON_LOGIN,
    );
    expect(outcome.status).toBe("replaced");
    if (outcome.status === "replaced") {
      expect(outcome.locator).toEqual({ role: "button", name: "Login now" });
      expect(outcome.reason).toContain("Login now");
    }
  });

  it("recovers a truncation in the other direction", () => {
    const outcome = findReplacement([node(1, "textbox", "Email")], {
      role: "textbox",
      name: "Email address",
    });
    expect(outcome.status).toBe("replaced");
    if (outcome.status === "replaced") {
      expect(outcome.locator).toEqual({ role: "textbox", name: "Email" });
    }
  });

  it("recovers a drifted role only on an exact name match", () => {
    const outcome = findReplacement([node(1, "link", "Login")], BUTTON_LOGIN);
    expect(outcome.status).toBe("replaced");
    if (outcome.status === "replaced") {
      expect(outcome.locator).toEqual({ role: "link", name: "Login" });
    }

    const fuzzy = findReplacement([node(1, "link", "Login now")], BUTTON_LOGIN);
    expect(fuzzy.status).toBe("refused");
  });

  it("refuses ambiguous and unrelated candidates", () => {
    const ambiguous = findReplacement(
      [node(1, "button", "Login now"), node(2, "button", "Login again")],
      BUTTON_LOGIN,
    );
    expect(ambiguous.status).toBe("refused");
    if (ambiguous.status === "refused") {
      expect(ambiguous.reason).toContain("equally close");
    }

    const unrelated = findReplacement([node(1, "button", "Sign in")], BUTTON_LOGIN);
    expect(unrelated.status).toBe("refused");
    if (unrelated.status === "refused") {
      expect(unrelated.reason).toContain("not confident");
    }
  });

  it("re-tests a name_re pattern and refuses when it matches nothing", () => {
    // The ordinal fell out of range while the pattern still matches.
    const matched = findReplacement([node(1, "button", "Login v2")], {
      role: "button",
      name_re: "^Login",
      ordinal: 5,
    });
    expect(matched.status).toBe("replaced");
    if (matched.status === "replaced") {
      expect(matched.locator).toEqual({ role: "button", name: "Login v2" });
    }

    const gone = findReplacement([node(1, "button", "Sign in")], {
      role: "button",
      name_re: "^Login",
    });
    expect(gone.status).toBe("refused");
  });

  it("refuses anchors it cannot recover by similarity", () => {
    expect(findReplacement([node(1, "link", "Anything")], { role: "button" }).status).toBe(
      "refused",
    );
    expect(findReplacement([node(1, "button", "Anything")], { test_id: "submit-btn" }).status).toBe(
      "refused",
    );
  });
});

describe("applyRepair", () => {
  it("rewrites the broken locator everywhere it appears", () => {
    const spec = caseSpec();
    const next = { role: "button", name: "Login now" };

    const { spec: repaired, changes } = applyRepair(spec, BUTTON_LOGIN, next);

    expect(repaired.steps[2]).toEqual({ do: "click", target: next });
    expect(repaired.expect[0]).toEqual({ visible: next });
    expect(repaired.steps[1]).toEqual(spec.steps[1]);
    expect(repaired.setup[0]).toEqual(spec.setup[0]);
    expect(changes).toEqual([
      { phase: "step", index: 2, from: BUTTON_LOGIN, to: next },
      { phase: "check", index: 0, from: BUTTON_LOGIN, to: next },
    ]);
  });

  it("rewrites setup occurrences and value checks", () => {
    const spec = caseSpec({
      setup: [{ do: "click", target: { role: "button", name: "Menu" } }],
      expect: [{ value: { target: { role: "button", name: "Menu" }, equals: "open" } }],
    });
    const from = { role: "button", name: "Menu" };
    const to = { role: "button", name: "Menu toggle" };

    const { spec: repaired, changes } = applyRepair(spec, from, to);

    expect(repaired.setup[0]).toEqual({ do: "click", target: to });
    expect(repaired.expect[0]).toEqual({ value: { target: to, equals: "open" } });
    expect(changes.map((change) => change.phase)).toEqual(["setup", "check"]);
  });
});
