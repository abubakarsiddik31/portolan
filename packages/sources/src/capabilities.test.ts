import type { OpDef } from "@abubakarsiddiik/protocol";
import { describe, expect, it } from "vitest";

import { buildCapabilities, coverageOf, gapsOf } from "./capabilities.js";
import type { DomDiscovery } from "./dom.js";
import type { OpProposal, SurfaceAction } from "./types.js";

function op(name: string, from: string, to: string): OpDef {
  return {
    name,
    version: 1,
    summary: name,
    params: { type: "object", properties: {}, required: [], additionalProperties: false },
    returns: { type: "object" },
    from: [from],
    to: [to],
    post: [],
    effect: "read",
    impls: [{ tier: "url", route: "/" + name, extract: { kind: "none" } }],
    status: "degraded",
  };
}

function proposal(
  name: string,
  from: string,
  to: string,
  trigger: OpProposal["trigger"],
): OpProposal {
  return { op: op(name, from, to), source: "dom", provenance: "test", confidence: "high", trigger };
}

const surface: SurfaceAction[] = [
  { page: "home", kind: "link", name: "Cart", target: "cart", href: "/cart" },
  { page: "home", kind: "form", name: "Search" },
  { page: "home", kind: "button", name: "Add Application" },
  { page: "home", kind: "button", name: "Sign out" },
];

function discovery(): DomDiscovery {
  return {
    origins: ["http://app.test"],
    states: [
      { id: "home", url: "/", marks: [] },
      { id: "cart", url: "/cart", marks: [] },
    ],
    proposals: [],
    tasks: [],
    surface,
    visited: ["http://app.test/"],
    pages: ["home"],
  };
}

describe("buildCapabilities", () => {
  it("keeps a link mapped when the existing map already has its op", () => {
    const existing: OpProposal = {
      op: op("open_cart", "home", "cart"),
      source: "dom",
      provenance: "existing map",
      confidence: "high",
    };

    const ledger = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [existing],
      now: "2026-11-17T00:00:00.000Z",
    });

    expect(ledger.capabilities.find((item) => item.trigger.name === "Cart")).toMatchObject({
      status: "mapped",
      op: "open_cart",
    });
  });

  it("separates mapped, missing, and excluded actions", () => {
    const ledger = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [
        proposal("open_cart", "home", "cart", { kind: "link", name: "Cart", page: "home" }),
        proposal("search", "home", "home", { kind: "form", name: "Search", page: "home" }),
      ],
      now: "2026-11-17T00:00:00.000Z",
    });

    const byName = new Map(ledger.capabilities.map((item) => [item.trigger.name, item]));
    expect(byName.get("Cart")?.status).toBe("mapped");
    expect(byName.get("Search")?.status).toBe("mapped");
    expect(byName.get("Add Application")?.status).toBe("missing");
    expect(byName.get("Sign out")?.status).toBe("excluded");

    expect(coverageOf(ledger)).toMatchObject({
      total: 4,
      mapped: 2,
      missing: 1,
      excluded: 1,
      ratio: 2 / 3,
    });
    expect(gapsOf(ledger).map((item) => item.trigger.name)).toEqual(["Add Application"]);
  });

  it("does not map a trigger whose only proposal failed verification", () => {
    const ledger = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [
        proposal("open_cart", "home", "cart", { kind: "link", name: "Cart", page: "home" }),
      ],
      unverified: new Map([["open_cart", "open_cart did not verify: every impl failed"]]),
      now: "2026-11-17T00:00:00.000Z",
    });

    expect(ledger.capabilities.find((item) => item.trigger.name === "Cart")).toEqual(
      expect.objectContaining({
        status: "missing",
        reason: "open_cart did not verify: every impl failed",
      }),
    );
  });

  it("keeps a trigger mapped when a verified op also covers it", () => {
    const ledger = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [
        proposal("open_cart_2", "home", "cart", { kind: "link", name: "Cart", page: "home" }),
        proposal("open_cart", "home", "cart", { kind: "link", name: "Cart", page: "home" }),
      ],
      unverified: new Map([["open_cart_2", "did not verify"]]),
      now: "2026-11-17T00:00:00.000Z",
    });

    expect(ledger.capabilities.find((item) => item.trigger.name === "Cart")).toMatchObject({
      status: "mapped",
      op: "open_cart",
    });
  });

  it("keeps a manual exclusion across rediscovery", () => {
    const first = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [],
      now: "2026-11-17T00:00:00.000Z",
    });

    const add = first.capabilities.find((item) => item.trigger.name === "Add Application");
    if (add === undefined) throw new Error("fixture is missing Add Application");
    add.status = "excluded";
    add.source = "manual";
    add.reason = "requires a paid plan";

    const next = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [],
      previous: first,
      now: "2026-11-18T00:00:00.000Z",
    });

    expect(next.capabilities.find((item) => item.id === add.id)).toMatchObject({
      status: "excluded",
      source: "manual",
      reason: "requires a paid plan",
    });
  });

  it("keeps code capabilities and marks vanished live ones stale", () => {
    const first = buildCapabilities({
      site: "app",
      discovery: discovery(),
      proposals: [],
      now: "2026-11-17T00:00:00.000Z",
    });

    first.capabilities.push({
      id: "api.create",
      page: "api",
      trigger: { kind: "button", name: "Create" },
      status: "missing",
      source: "code",
    });
    first.capabilities.push({
      id: "home.button.legacy",
      page: "home",
      trigger: { kind: "button", name: "Legacy" },
      status: "mapped",
      source: "live",
      op: "legacy",
    });

    const next = buildCapabilities({
      site: "app",
      discovery: { ...discovery(), surface: [] },
      proposals: [],
      previous: first,
      now: "2026-11-18T00:00:00.000Z",
    });

    const byId = new Map(next.capabilities.map((item) => [item.id, item]));
    expect(byId.get("api.create")?.status).toBe("missing");
    expect(byId.get("home.button.legacy")?.status).toBe("stale");
  });

  const ledgerWith = (items: Array<[string, string, string]>) => ({
    schema: 1 as const,
    site: "app",
    generated_at: "2026-11-17T00:00:00.000Z",
    capabilities: items.map(([page, name, status]) => ({
      id: `${page}.button.${name.toLowerCase()}`,
      page,
      trigger: { kind: "button" as const, name },
      status: status as "mapped" | "missing",
      source: "live" as const,
      ...(status === "mapped" ? { op: "known" } : {}),
    })),
  });

  it("keeps live capabilities when the run did not crawl at all", () => {
    const next = buildCapabilities({
      site: "app",
      proposals: [],
      previous: ledgerWith([
        ["home", "Export", "mapped"],
        ["settings", "Save", "missing"],
      ]),
    });

    expect(next.capabilities.map((item) => item.status).sort()).toEqual(["mapped", "missing"]);
  });

  it("maps a previously missing capability when a trace op now covers it", () => {
    const next = buildCapabilities({
      site: "app",
      proposals: [
        proposal("op_export", "home", "home", { kind: "button", name: "Export", page: "home" }),
      ],
      previous: ledgerWith([["home", "Export", "missing"]]),
    });

    expect(next.capabilities[0]).toMatchObject({ status: "mapped", op: "op_export" });
  });

  it("does not mark pages stale that a partial crawl never reached", () => {
    const next = buildCapabilities({
      site: "app",
      discovery: { ...discovery(), surface: [], pages: ["home"] },
      proposals: [],
      previous: ledgerWith([
        ["home", "Legacy", "mapped"],
        ["settings", "Save", "mapped"],
      ]),
    });

    const byPage = new Map(next.capabilities.map((item) => [item.page, item.status]));
    expect(byPage.get("home")).toBe("stale");
    expect(byPage.get("settings")).toBe("mapped");
  });

  it("marks a control that was disabled everywhere as unavailable, not missing", () => {
    const ledger = buildCapabilities({
      site: "app",
      discovery: {
        ...discovery(),
        surface: [
          { page: "home", kind: "button", name: "Next", disabled: true },
          { page: "home", kind: "button", name: "Export" },
        ],
      },
      proposals: [],
      now: "2026-11-17T00:00:00.000Z",
    });

    const next = ledger.capabilities.find((item) => item.trigger.name === "Next");
    expect(next).toMatchObject({
      status: "unavailable",
      precondition: "disabled on home in this data",
    });
    expect(ledger.capabilities.find((item) => item.trigger.name === "Export")?.status).toBe(
      "missing",
    );

    const coverage = coverageOf(ledger);
    expect(coverage).toMatchObject({ missing: 1, unavailable: 1, ratio: 0 });
    expect(gapsOf(ledger).map((item) => item.trigger.name)).toEqual(["Export"]);
  });

  it("explains an exclusion by category, and leaves a bell and a question alone", () => {
    const ledger = buildCapabilities({
      site: "app",
      discovery: {
        ...discovery(),
        surface: [
          { page: "home", kind: "button", name: "Sign out" },
          { page: "home", kind: "button", name: "Delete account" },
          { page: "home", kind: "button", name: "Notifications" },
          { page: "home", kind: "button", name: "What is a map?" },
          { page: "home", kind: "button", name: "Open devtools" },
        ],
      },
      proposals: [],
      rules: [{ category: "dev-only", label: "devtools", reason: "not part of the app" }],
    });

    const byName = new Map(ledger.capabilities.map((item) => [item.trigger.name, item]));
    expect(byName.get("Sign out")).toMatchObject({ status: "excluded", category: "session" });
    expect(byName.get("Delete account")?.reason).toContain("destructive: removes data");
    expect(byName.get("Open devtools")).toMatchObject({
      status: "excluded",
      category: "dev-only",
    });
    expect(byName.get("Notifications")?.status).toBe("missing");
    expect(byName.get("What is a map?")?.status).toBe("missing");
  });
});
