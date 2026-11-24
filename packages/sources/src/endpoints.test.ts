import type { OpDef } from "@abubakarsiddiik/protocol";
import type { NetworkEffect } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { clusterEndpoints, endpointCoverage, linkEndpoints } from "./endpoints.js";

function call(overrides: Partial<NetworkEffect> & { url: string }): NetworkEffect {
  return { kind: "network", method: "GET", status: 200, resource_type: "Fetch", ...overrides };
}

describe("clusterEndpoints", () => {
  const endpoints = clusterEndpoints(
    [
      {
        page: "keys",
        effect: call({
          url: "http://api.test/api/orgs/org_123/keys?limit=20",
          response_body: [{ id: "k1", name: "ci" }],
        }),
      },
      {
        page: "keys",
        effect: call({
          url: "http://api.test/api/orgs/org_456/keys?limit=5&q=a",
          response_body: [{ id: "k2", name: "x" }],
        }),
      },
      {
        page: "settings",
        effect: call({
          method: "POST",
          url: "http://api.test/api/orgs/org_123/keys",
          status: 201,
          request_body: { name: "ci" },
          response_body: { id: "k3" },
          auth: { header: "authorization", scheme: "Bearer" },
        }),
      },
    ],
    "http://app.test",
  );

  it("groups calls that differ only in an id and unions their parameters", () => {
    expect(endpoints).toHaveLength(2);
    expect(endpoints.find((endpoint) => endpoint.method === "GET")).toMatchObject({
      id: "GET http://api.test/api/orgs/{id}/keys",
      origin: "http://api.test",
      query: ["limit", "q"],
      response_keys: ["id", "name"],
      list: true,
      count: 2,
      pages: ["keys"],
    });
  });

  it("keeps a write's body shape, status and whether it was authenticated", () => {
    expect(endpoints.find((endpoint) => endpoint.method === "POST")).toMatchObject({
      request_keys: ["name"],
      status: [201],
      auth: true,
      pages: ["settings"],
    });
  });
});

describe("linkEndpoints", () => {
  const ops = [
    {
      name: "create_key",
      impls: [
        {
          tier: "http",
          steps: [{ method: "POST", url: "/api/orgs/{org_id}/keys" }],
          extract: { kind: "none" },
        },
      ],
    },
  ] as unknown as OpDef[];

  it("marks an endpoint an op calls and counts the writes nothing reaches", () => {
    const linked = linkEndpoints(
      [
        {
          id: "a",
          method: "POST",
          path: "/api/orgs/{id}/keys",
          status: [201],
          pages: [],
          count: 1,
        },
        { id: "b", method: "DELETE", path: "/api/keys/{id}", status: [204], pages: [], count: 1 },
        { id: "c", method: "GET", path: "/api/me", status: [200], pages: [], count: 1 },
      ],
      ops,
    );

    expect(linked[0]?.op).toBe("create_key");
    expect(endpointCoverage(linked)).toEqual({ total: 3, covered: 1, uncoveredWrites: 1 });
  });
});
