import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { findChrome } from "./chrome.js";
import { PlaywrightEngine } from "./playwright-engine.js";
import { Substrate } from "./substrate.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const TOKEN = "tok_9f3a1c7e";

/**
 * A Bearer-token single-page app: the token is persisted in a store in
 * localStorage and the API is on a different origin from the page.
 */
describe.skipIf(!ENABLED)("http auth", () => {
  vi.setConfig({ testTimeout: 20_000 });

  let page: Server | undefined;
  let api: Server | undefined;
  let pageUrl = "";
  let apiUrl = "";
  let engine: PlaywrightEngine | undefined;
  let substrate: Substrate | undefined;

  function listen(server: Server): Promise<string> {
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  beforeAll(async () => {
    api = createServer((request, response) => {
      response.setHeader("access-control-allow-origin", pageUrl);
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.setHeader("access-control-allow-methods", "GET, POST");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end('{"detail":"Not authenticated"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"id":7,"name":"created"}');
    });
    apiUrl = await listen(api);

    page = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>App</title></head><body>
        <script>
          localStorage.setItem("auth-store", JSON.stringify({ state: { token: "${TOKEN}" } }));
        </script>
        <button onclick="fetch('${apiUrl}/keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ${TOKEN}' },
          body: JSON.stringify({ name: 'ci' }),
        })">Create</button>
      </body></html>`);
    });
    pageUrl = await listen(page);

    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
    substrate = new Substrate(engine);
    await substrate.goto(pageUrl);
  }, 60_000);

  afterAll(async () => {
    await engine?.close();
    for (const server of [page, api]) {
      await new Promise<void>((resolve) => {
        if (server === undefined) resolve();
        else server.close(() => resolve());
      });
    }
  });

  it("is refused without the token, which is the 401 a plain replay gets", async () => {
    const response = await substrate?.fetch({ method: "POST", url: `${apiUrl}/keys` });

    expect(response?.status).toBe(401);
  });

  it("sends the token the page keeps in a persisted store", async () => {
    const response = await substrate?.fetch({
      method: "POST",
      url: `${apiUrl}/keys`,
      body: { name: "ci" },
      headers: { "content-type": "application/json" },
      auth: {
        kind: "bearer",
        source: "localStorage",
        key: "auth-store",
        path: "state.token",
      },
    });

    expect(response).toMatchObject({ status: 200, json: { id: 7 } });
  });

  it("says so when the token is not in the page", async () => {
    const response = await substrate?.fetch({
      method: "GET",
      url: `${apiUrl}/keys`,
      auth: { kind: "bearer", source: "localStorage", key: "missing" },
    });

    expect(response?.status).toBe(0);
    expect(response?.error).toMatch(/sign in again/);
  });

  it("records where the page keeps the token, never the token", async () => {
    const view = await substrate?.view();
    const button = [...(view?.refs.byRef.values() ?? [])].find((entry) => entry.name === "Create");
    if (button === undefined || substrate === undefined) throw new Error("no Create button");

    const result = await substrate.act({ ref: button.ref, do: "click" });
    if (!result.ok) throw new Error("click failed");

    const write = result.effects.find((effect) => effect.kind === "network");
    expect(write).toMatchObject({
      kind: "network",
      auth: {
        header: "authorization",
        scheme: "Bearer",
        source: "localStorage",
        key: "auth-store",
        path: "state.token",
      },
    });
    expect(JSON.stringify(result.effects)).not.toContain(TOKEN);
  });
});
