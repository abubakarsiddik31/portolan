import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { HttpResponse, Substrate } from "@abubakarsiddiik/substrate";
import { describe, expect, it, vi } from "vitest";

import { runHttpOp } from "./http.js";

const MAP: SiteMap = {
  site: "test",
  origins: ["http://x"],
  version: 1,
  states: [],
  ops: [],
  entities: {},
  compiled_from: [],
  verified_at: "2026-11-08T00:00:00Z",
};

function op(overrides: Partial<OpDef> = {}): OpDef {
  return {
    name: "list",
    version: 1,
    summary: "list",
    params: { type: "object", properties: {}, additionalProperties: false },
    returns: { type: "object", properties: {}, additionalProperties: true },
    from: [],
    to: [],
    post: [],
    effect: "read",
    impls: [
      {
        tier: "http",
        steps: [{ method: "GET", url: "/api/items?q={query}" }],
        extract: { kind: "json", path: "items.0" },
      },
    ],
    status: "verified",
    ...overrides,
  };
}

function substrate(response: HttpResponse | HttpResponse[]): {
  substrate: Substrate;
  fetch: ReturnType<typeof vi.fn>;
} {
  const queue = Array.isArray(response) ? [...response] : [response];
  const fetch = vi.fn(async () => queue.shift() ?? response);
  return { substrate: { fetch } as unknown as Substrate, fetch };
}

const OK: HttpResponse = {
  status: 200,
  text: JSON.stringify({ items: [{ id: "i1" }] }),
  json: { items: [{ id: "i1" }] },
};

describe("runHttpOp", () => {
  it("runs one request and extracts from the JSON body", async () => {
    const { substrate: fake, fetch } = substrate(OK);

    const result = await runHttpOp({
      map: MAP,
      op: op(),
      params: { query: "tee" },
      substrate: fake,
    });

    expect(result).toMatchObject({ ok: true, result: { id: "i1" }, status: 200 });
    expect(fetch).toHaveBeenCalledWith({
      method: "GET",
      url: "http://x/api/items?q=tee",
      headers: undefined,
      body: undefined,
    });
  });

  it("binds a value from one response into the next request", async () => {
    const { substrate: fake, fetch } = substrate([
      { status: 200, text: "{}", json: { token: "t-1" } },
      { status: 200, text: "{}", json: { ok: true } },
    ]);

    const bound = op({
      impls: [
        {
          tier: "http",
          steps: [
            { method: "GET", url: "/token", bind: { token: "token" } },
            {
              method: "POST",
              url: "/submit",
              headers: { "x-token": "{token}" },
              body: { token: "{token}" },
            },
          ],
          extract: { kind: "json", path: "" },
        },
      ],
    });

    const result = await runHttpOp({ map: MAP, op: bound, params: {}, substrate: fake });

    expect(result).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://x/submit",
        headers: { "x-token": "t-1" },
        body: { token: "t-1" },
      }),
    );
  });

  it("reports a missing route param", async () => {
    const { substrate: fake } = substrate(OK);

    expect(await runHttpOp({ map: MAP, op: op(), params: {}, substrate: fake })).toMatchObject({
      ok: false,
      code: "invalid_params",
    });
  });

  it("reports a non-2xx response", async () => {
    const { substrate: fake } = substrate({ status: 500, text: "nope", json: undefined });

    expect(
      await runHttpOp({ map: MAP, op: op(), params: { query: "x" }, substrate: fake }),
    ).toMatchObject({ ok: false, code: "op_broken", details: { status: 500 } });
  });

  it("reports a bind path that does not resolve", async () => {
    const { substrate: fake } = substrate({ status: 200, text: "{}", json: {} });
    const bound = op({
      impls: [
        {
          tier: "http",
          steps: [{ method: "GET", url: "/token", bind: { token: "missing.path" } }],
          extract: { kind: "none" },
        },
      ],
    });

    expect(await runHttpOp({ map: MAP, op: bound, params: {}, substrate: fake })).toMatchObject({
      ok: false,
      code: "op_broken",
    });
  });

  it("refuses an op with no http impl", async () => {
    const { substrate: fake } = substrate(OK);
    const url = op({
      impls: [{ tier: "url", route: "/x", extract: { kind: "none" } }],
    });

    expect(
      await runHttpOp({ map: MAP, op: url, params: { query: "x" }, substrate: fake }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("refuses a map with no origin", async () => {
    const { substrate: fake } = substrate(OK);

    expect(
      await runHttpOp({
        map: { ...MAP, origins: [] },
        op: op(),
        params: { query: "x" },
        substrate: fake,
      }),
    ).toMatchObject({ ok: false, code: "op_broken" });
  });

  it("reports a missing header param", async () => {
    const { substrate: fake } = substrate(OK);
    const header = op({
      impls: [
        {
          tier: "http",
          steps: [{ method: "GET", url: "/x", headers: { "x-id": "{id}" } }],
          extract: { kind: "none" },
        },
      ],
    });

    expect(await runHttpOp({ map: MAP, op: header, params: {}, substrate: fake })).toMatchObject({
      ok: false,
      code: "invalid_params",
    });
  });
});
