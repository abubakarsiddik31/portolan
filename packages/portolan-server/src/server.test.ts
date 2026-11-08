import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("returns invalid_request for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });
});
