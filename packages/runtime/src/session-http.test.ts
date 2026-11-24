import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runHttpOp } from "./http.js";
import { type StorageState, sessionTransport } from "./session-http.js";

let server: Server;
let api = "";
const seen: Array<{ method?: string; headers: Record<string, unknown>; body: string }> = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      seen.push({ method: request.method, headers: request.headers, body });
      if (request.headers.authorization !== "Bearer tok_1") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end('{"detail":"Not authenticated"}');
        return;
      }
      response.writeHead(201, { "content-type": "application/json" });
      response.end('{"id":"key_9","name":"ci"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  api = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const STATE: StorageState = {
  cookies: [
    { name: "sid", value: "abc", domain: "127.0.0.1", path: "/", expires: -1 },
    { name: "other", value: "x", domain: "elsewhere.test", path: "/" },
    { name: "old", value: "y", domain: "127.0.0.1", path: "/", expires: 10 },
  ],
  origins: [
    {
      origin: "http://app.test",
      localStorage: [{ name: "auth-store", value: '{"state":{"token":"tok_1"}}' }],
    },
  ],
};

const auth = {
  kind: "bearer",
  source: "localStorage",
  key: "auth-store",
  path: "state.token",
} as const;

describe("sessionTransport", () => {
  it("sends the saved token and only the cookies that belong to the URL", async () => {
    const transport = sessionTransport({ state: STATE, pageOrigin: "http://app.test" });

    const response = await transport.fetch({
      method: "POST",
      url: `${api}/keys`,
      body: { name: "ci" },
      auth,
    });

    expect(response).toMatchObject({ status: 201, json: { id: "key_9" } });
    const request = seen.at(-1);
    expect(request?.headers.authorization).toBe("Bearer tok_1");
    expect(request?.headers.cookie).toBe("sid=abc");
    expect(request?.headers.origin).toBe("http://app.test");
    expect(request?.body).toBe('{"name":"ci"}');
  });

  it("reports a missing token instead of sending an unauthenticated write", async () => {
    const before = seen.length;
    const transport = sessionTransport({
      state: { origins: [] },
      pageOrigin: "http://app.test",
    });

    const response = await transport.fetch({ method: "POST", url: `${api}/keys`, auth });

    expect(response.status).toBe(0);
    expect(response.error).toMatch(/sign in again/);
    expect(seen).toHaveLength(before);
  });

  it("cannot read a token kept in sessionStorage", async () => {
    const transport = sessionTransport({ state: STATE, pageOrigin: "http://app.test" });

    const response = await transport.fetch({
      method: "GET",
      url: `${api}/keys`,
      auth: { kind: "bearer", source: "sessionStorage", key: "auth-store" },
    });

    expect(response.error).toMatch(/sign in again/);
  });

  it("lets the egress guard refuse a request before it is sent", async () => {
    const before = seen.length;
    const transport = sessionTransport({
      state: STATE,
      pageOrigin: "http://app.test",
      guard: () => {
        throw new Error("egress blocked: not_allowed");
      },
    });

    await expect(transport.fetch({ method: "GET", url: `${api}/keys`, auth })).rejects.toThrow(
      /egress blocked/,
    );
    expect(seen).toHaveLength(before);
  });

  it("runs an http op end to end without a page", async () => {
    const transport = sessionTransport({ state: STATE, pageOrigin: "http://app.test" });

    const result = await runHttpOp({
      map: {
        site: "app",
        origins: [api],
        version: 1,
        states: [],
        ops: [],
        entities: {},
        compiled_from: [],
        verified_at: "2026-11-08T00:00:00Z",
      },
      op: {
        name: "create_key",
        version: 1,
        summary: "Create an API key.",
        params: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
        returns: { type: "object" },
        from: ["x"],
        to: ["x"],
        post: [],
        effect: "write",
        impls: [
          {
            tier: "http",
            auth,
            steps: [{ method: "POST", url: "/keys", body: { name: "{name}" } }],
            extract: { kind: "json", path: "" },
          },
        ],
        status: "verified",
      },
      params: { name: "ci" },
      substrate: transport,
    });

    expect(result).toMatchObject({ ok: true, status: 201 });
  });
});
