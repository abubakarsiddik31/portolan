import type { SemanticNode, Snapshot } from "@abubakarsiddiik/substrate";
import { buildRefMap } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { evaluateCheck, matchUrl } from "./checks.js";
import type { QaSubstrate, QaView } from "./types.js";

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

function view(nodes: SemanticNode[]): QaView {
  const snapshot: Snapshot = { doc: 1, v: 1, url: "http://app", title: "App", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

const substrate = {
  read: async () => ({ text: "" }),
} as unknown as QaSubstrate;

describe("evaluateCheck absent", () => {
  it("passes when the locator does not resolve", async () => {
    const outcome = await evaluateCheck({
      check: { absent: { role: "button", name: "Delete workspace" } },
      view: view([node(1, "button", "Save")]),
      substrate,
    });

    expect(outcome.ok).toBe(true);
  });

  it("reports the expected absence and what resolved, with the ref", async () => {
    const deleteButton = node(7, "button", "Delete workspace");
    const snapshot = view([deleteButton]);
    const ref = snapshot.refs.byNode.get("n7")?.ref;
    const outcome = await evaluateCheck({
      check: { absent: { role: "button", name: "Delete workspace" } },
      view: snapshot,
      substrate,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.message).toContain("expected locator to be absent");
    expect(outcome.expected).toEqual({
      absent: { role: "button", name: "Delete workspace" },
    });
    expect(outcome.actual).toMatchObject({
      resolved: { role: "button", name: "Delete workspace" },
      role: "button",
      name: "Delete workspace",
      ref,
    });
  });
});

describe("matchUrl", () => {
  const url = "http://app/analytics?range=30d&page=2#overview";

  it("matches the path of a plain pattern, as before", () => {
    expect(matchUrl("^/analytics$", url)).toEqual({ ok: true });
    expect(matchUrl("/dashboard", url)).toMatchObject({ ok: false, actual: "/analytics" });
  });

  it("matches the whole URL when the pattern names a query or a fragment", () => {
    expect(matchUrl("/analytics\\?range=30d", url)).toEqual({ ok: true });
    expect(matchUrl("/analytics\\?range=7d", url)).toMatchObject({ ok: false });
    expect(matchUrl("#overview$", url)).toEqual({ ok: true });
  });

  it("checks each part the object form names", () => {
    expect(
      matchUrl({ pathname: "^/analytics$", query: { range: "30d" }, hash: "overview" }, url),
    ).toEqual({
      ok: true,
    });
    expect(matchUrl({ query: { range: "7d" } }, url)).toMatchObject({
      ok: false,
      message: 'url query range was "30d", expected "7d"',
    });
    expect(matchUrl({ query: { missing: "x" } }, url)).toMatchObject({
      message: 'url query missing was absent, expected "x"',
    });
    expect(matchUrl({ hash: "details" }, url)).toMatchObject({ ok: false });
  });
});
