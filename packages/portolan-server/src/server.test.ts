import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildRefMap, type SemanticNode, type Snapshot } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrowserRegistry } from "./browsers.js";
import { MapStore } from "./maps.js";
import { createServer } from "./server.js";
import { SessionStore } from "./store.js";

const MAPS = join(import.meta.dirname, "../../../maps");

describe("server", () => {
  let app: FastifyInstance;
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
    app = createServer({ store });
  });

  afterEach(async () => {
    await app.close();
    store.closeDatabase();
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, result: { status: "ok" } });
  });

  it("starts and stops the canary scheduler with the server", async () => {
    const calls: string[] = [];
    const canary = {
      start: () => calls.push("start"),
      stop: () => calls.push("stop"),
    } as unknown as import("./canary.js").CanaryScheduler;

    const http = createServer({ store, canary });
    expect(calls).toEqual(["start"]);

    await http.close();
    expect(calls).toEqual(["start", "stop"]);
  });

  it("reports per-op health for a site", async () => {
    const http = createServer({ store, maps: new MapStore(MAPS) });
    store.recordOpHealth({
      site: "store",
      op: "search",
      map_version: 1,
      status: "healthy",
      checked_at: "2026-11-09T00:00:00.000Z",
      ms: 5,
    });

    const response = await http.inject({ method: "GET", url: "/v1/sites/store/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result).toMatchObject({ site: "store", version: 1 });
    expect(body.result.ops.find((op: { name: string }) => op.name === "search")).toMatchObject({
      status: "healthy",
      checked_at: "2026-11-09T00:00:00.000Z",
      ms: 5,
    });
    expect(body.result.ops.find((op: { name: string }) => op.name === "get_product")).toMatchObject(
      { status: "unknown" },
    );

    await http.close();
  });

  it("returns 404 for an unknown site's health", async () => {
    const http = createServer({ store, maps: new MapStore(MAPS) });

    const response = await http.inject({ method: "GET", url: "/v1/sites/nope/health" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "map_not_found" },
    });

    await http.close();
  });

  it("creates a session bound to a site", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { site: "store" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.result.site).toBe("store");
    expect(store.get(body.result.sid)).toBeDefined();
  });

  it("creates an unbound session with no body", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/sessions" });

    expect(response.statusCode).toBe(201);
    expect(response.json().result.sid).toBeTypeOf("string");
  });

  it("rejects malformed JSON with invalid_request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("rejects a wrong field type with details", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { site: 42 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it("reads a session", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { site: "portal" },
    });
    const { sid } = created.json().result;

    const response = await app.inject({ method: "GET", url: `/v1/sessions/${sid}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.sid).toBe(sid);
  });

  it("returns session_not_found for an unknown id", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sessions/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "session_not_found" },
    });
  });

  it("closes a session once", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/sessions" });
    const { sid } = created.json().result;

    const first = await app.inject({ method: "DELETE", url: `/v1/sessions/${sid}` });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, result: { sid, closed: true } });

    const second = await app.inject({ method: "DELETE", url: `/v1/sessions/${sid}` });
    expect(second.statusCode).toBe(404);
    expect(second.json()).toMatchObject({
      ok: false,
      error: { code: "session_not_found" },
    });
  });

  it("keeps a closed session readable for audit", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/sessions" });
    const { sid } = created.json().result;
    await app.inject({ method: "DELETE", url: `/v1/sessions/${sid}` });

    const response = await app.inject({ method: "GET", url: `/v1/sessions/${sid}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.closed_at).toBeTypeOf("string");
  });

  it("serves the mcp surface over streamable http", async () => {
    const http = createServer({ store, maps: new MapStore(MAPS) });
    await http.listen({ port: 0, host: "127.0.0.1" });

    const address = http.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the server did not get a port");
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    const client = new Client({ name: "http-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "list_sites",
        "open_site",
        "call",
        "fallback_begin",
        "view",
        "act",
        "read",
        "fallback_done",
      ]);
    } finally {
      await client.close();
      await http.close();
    }
  });

  it("serves view through a substrate factory over http", async () => {
    const node: SemanticNode = {
      nodeId: "button:Go",
      role: "button",
      name: "Go",
      backendNodeId: 1,
      ignored: false,
      visible: true,
      properties: {},
      childIds: [],
      bounds: { x: 0, y: 0, width: 40, height: 20 },
    };
    const snapshot: Snapshot = { doc: 1, v: 0, url: "http://x/", title: "", nodes: [node] };
    const view = { snapshot, refs: buildRefMap([node], 1) };

    const http = createServer({
      store,
      maps: new MapStore(MAPS),
      substrateFactory: () => ({
        view: async () => view,
        state: () => view,
        read: async () => ({ text: "Go" }),
        act: async () => ({ ok: false, code: "invalid_request", message: "not in this test" }),
      }),
    });
    await http.listen({ port: 0, host: "127.0.0.1" });

    const address = http.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the server did not get a port");
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    const client = new Client({ name: "http-view", version: "0.0.0" });

    try {
      await client.connect(transport);
      await client.callTool({ name: "open_site", arguments: { site: "store" } });
      const result = await client.callTool({ name: "view", arguments: {} });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      const body = JSON.parse(text) as {
        untrusted: boolean;
        affordances: Array<{ name: string }>;
      };

      expect(body.untrusted).toBe(true);
      expect(body.affordances).toContainEqual(expect.objectContaining({ name: "Go" }));
    } finally {
      await client.close();
      await http.close();
    }
  });

  it("lists the audit log for a session", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/sessions" });
    const { sid } = created.json().result;

    store.recordAudit({
      id: "a1",
      sid,
      site: "store",
      op: "checkout",
      effect: "irreversible",
      params: {},
      outcome: "done",
      created_at: "2026-11-08T00:00:00Z",
    });

    const response = await app.inject({ method: "GET", url: `/v1/sessions/${sid}/audit` });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toHaveLength(1);
    expect(response.json().result[0]).toMatchObject({ op: "checkout", outcome: "done" });
  });

  it("returns session_not_found for an unknown audit session", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sessions/nope/audit" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "session_not_found" },
    });
  });

  it("rejects a create at the session cap", async () => {
    const http = createServer({ store, maxOpenSessions: 2 });

    expect((await http.inject({ method: "POST", url: "/v1/sessions" })).statusCode).toBe(201);
    expect((await http.inject({ method: "POST", url: "/v1/sessions" })).statusCode).toBe(201);

    const third = await http.inject({ method: "POST", url: "/v1/sessions" });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({
      ok: false,
      error: {
        code: "precondition_failed",
        details: { reason: "session_limit", open: 2, cap: 2 },
      },
    });

    await http.close();
  });

  it("frees a cap slot when a session closes", async () => {
    const http = createServer({ store, maxOpenSessions: 1 });
    const created = await http.inject({ method: "POST", url: "/v1/sessions" });
    const { sid } = created.json().result;

    expect((await http.inject({ method: "POST", url: "/v1/sessions" })).statusCode).toBe(429);
    await http.inject({ method: "DELETE", url: `/v1/sessions/${sid}` });
    expect((await http.inject({ method: "POST", url: "/v1/sessions" })).statusCode).toBe(201);

    await http.close();
  });

  it("closes sessions left open by a previous process", async () => {
    const stale = new SessionStore();
    const leftover = stale.create({ site: "store" });

    const http = createServer({ store: stale, recoverSessions: true });
    expect(stale.get(leftover.sid)?.closed_at).toBeTypeOf("string");
    expect(stale.countOpen()).toBe(0);

    await http.close();
    stale.closeDatabase();
  });

  it("settles a pending write at startup", async () => {
    const stale = new SessionStore();
    stale.writeLedger().put({
      key: "k",
      site: "store",
      op: "pay",
      status: "pending",
      updatedAt: "2026-11-09T00:00:00.000Z",
    });

    const http = createServer({ store: stale, recoverSessions: true });
    expect(stale.writeLedger().get("k")?.status).toBe("unknown");

    await http.close();
    stale.closeDatabase();
  });

  it("leaves sessions alone when recovery is disabled", async () => {
    const kept = new SessionStore();
    const leftover = kept.create({ site: "store" });

    const http = createServer({ store: kept, recoverSessions: false });
    expect(kept.get(leftover.sid)?.closed_at).toBeUndefined();
    expect(kept.countOpen()).toBe(1);

    await http.close();
    kept.closeDatabase();
  });

  it("sweeps expired sessions on the cleanup interval", async () => {
    const idle = new SessionStore();
    const http = createServer({
      store: idle,
      sessionTtlMs: 1,
      cleanupIntervalMs: 5,
      recoverSessions: false,
    });
    const session = idle.create();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(idle.get(session.sid)?.closed_at).toBeTypeOf("string");

    await http.close();
    idle.closeDatabase();
  });

  it("closes a session's browser on delete", async () => {
    const browsers = new BrowserRegistry();
    const closed: string[] = [];
    browsers.register("sid-1", { close: () => void closed.push("sid-1") });
    browsers.register("sid-2", { close: () => void closed.push("sid-2") });

    const http = createServer({ store, browsers, recoverSessions: false });
    const created = await http.inject({ method: "POST", url: "/v1/sessions" });
    const { sid } = created.json().result;
    browsers.register(sid, { close: () => void closed.push(sid) });

    await http.inject({ method: "DELETE", url: `/v1/sessions/${sid}` });
    expect(closed).toContain(sid);

    await http.close();
    expect(closed).toEqual(expect.arrayContaining(["sid-1", "sid-2"]));
    expect(browsers.size()).toBe(0);
  });

  it("returns invalid_request for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });
});
