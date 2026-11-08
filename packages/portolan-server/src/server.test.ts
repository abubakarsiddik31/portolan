import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServer } from "./server.js";
import { SessionStore } from "./store.js";

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

  it("returns invalid_request for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });
});
