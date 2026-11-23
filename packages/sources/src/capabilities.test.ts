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
});
