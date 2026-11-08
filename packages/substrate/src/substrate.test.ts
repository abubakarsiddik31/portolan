import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChrome } from "./chrome.js";
import { PlaywrightEngine } from "./playwright-engine.js";
import type { RefMap } from "./refs.js";
import { Substrate } from "./substrate.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const HOME = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Substrate test</title></head>
<body>
  <h1>Substrate test</h1>
  <label for="q">Search</label>
  <input id="q" name="q">
  <button id="go" onclick="document.getElementById('out').textContent = document.getElementById('q').value">Go</button>
  <button id="fetch" onclick="fetch('/api')">Fetch</button>
  <button id="post" onclick="fetch('/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'tee' }) })">Post</button>
  <output id="out"></output>
  <a href="/done">Submit</a>
</body>
</html>`;

const DONE = `<!doctype html>
<html lang="en"><head><title>Done</title></head><body><h1>Done</h1></body></html>`;

const BLOCKED = `<!doctype html>
<html lang="en">
<head><title>Blocked</title></head>
<body>
  <button id="covered">Covered</button>
  <div role="dialog" aria-label="Cookie banner"
       style="position:fixed;inset:0;background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center">
    Accept cookies
  </div>
</body>
</html>`;

function chromePath(): string {
  if (CHROME === undefined) throw new Error("Chrome is required");
  return CHROME;
}

function refFor(refs: RefMap, role: string, name: string): string {
  for (const entry of refs.byRef.values()) {
    if (entry.role === role && entry.name === name) return entry.ref;
  }
  throw new Error(`no ${role} named "${name}"`);
}

describe.skipIf(!ENABLED)("substrate act", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let engine: PlaywrightEngine | undefined;
  let substrate: Substrate | undefined;

  beforeAll(async () => {
    const started = createServer((request, response) => {
      const url = request.url ?? "/";

      if (url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(HOME);
        return;
      }
      if (url === "/done") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(DONE);
        return;
      }
      if (url === "/blocked") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(BLOCKED);
        return;
      }
      if (url === "/api") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
        return;
      }
      if (url === "/api/echo") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"echo":{"q":"tee"}}');
        return;
      }

      response.writeHead(404).end();
    });
    server = started;

    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });

    const address = started.address();
    if (address === null || typeof address === "string") {
      throw new Error("the test server did not get a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
    substrate = new Substrate(engine);
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  function current(): { engine: PlaywrightEngine; substrate: Substrate } {
    if (engine === undefined || substrate === undefined) {
      throw new Error("the substrate is not running");
    }
    return { engine, substrate };
  }

  it("fills and clicks by ref", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();

    const search = refFor(view.refs, "textbox", "Search");
    const go = refFor(view.refs, "button", "Go");

    expect(await substrate.act({ ref: search, do: "fill", value: "tee" })).toMatchObject({
      ok: true,
    });
    expect(await substrate.act({ ref: go, do: "click" })).toMatchObject({ ok: true });

    await expect(
      engine.evaluate<string>("document.getElementById('out').textContent"),
    ).resolves.toBe("tee");
  });

  it("reports a value effect and a small delta for a fill", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const search = refFor(view.refs, "textbox", "Search");

    const result = await substrate.act({ ref: search, do: "fill", value: "tee" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a successful act");
    expect(result.effects).toContainEqual(expect.objectContaining({ kind: "value", value: "tee" }));
    expect(result.delta.navigation).toBe(false);
    expect(result.delta.entries.length / view.snapshot.nodes.length).toBeLessThanOrEqual(0.15);
  });

  it("records a network effect", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const fetchButton = refFor(view.refs, "button", "Fetch");

    const result = await substrate.act({ ref: fetchButton, do: "click" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a successful act");
    expect(result.effects).toContainEqual(
      expect.objectContaining({
        kind: "network",
        method: "GET",
        url: expect.stringContaining("/api"),
        status: 200,
        mime_type: "application/json",
        response_body: { ok: true },
      }),
    );
  });

  it("attributes JSON request and response bodies to the action", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const post = refFor(view.refs, "button", "Post");

    const result = await substrate.act({ ref: post, do: "click" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a successful act");
    expect(result.effects).toContainEqual(
      expect.objectContaining({
        kind: "network",
        method: "POST",
        url: expect.stringContaining("/api/echo"),
        status: 200,
        mime_type: "application/json",
        request_body: { q: "tee" },
        response_body: { echo: { q: "tee" } },
      }),
    );
  });

  it("waits for a navigation and advances the document", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const before = await substrate.view();
    const submit = refFor(before.refs, "link", "Submit");

    const result = await substrate.act({ ref: submit, do: "click" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a successful act");
    expect(result.url).toBe(`${baseUrl}/done`);
    expect(result.doc).toBeGreaterThan(before.snapshot.doc);
    expect(result.effects).toContainEqual(
      expect.objectContaining({ kind: "navigation", to: `${baseUrl}/done` }),
    );
    expect(result.delta.navigation).toBe(true);
    expect(result.delta.entries).toEqual([]);
  });

  it("reports a stale ref after a navigation", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const before = await substrate.view();
    const go = refFor(before.refs, "button", "Go");

    await engine.navigate(`${baseUrl}/done`);
    await substrate.view();

    expect(await substrate.act({ ref: go, do: "click" })).toMatchObject({
      ok: false,
      code: "stale_ref",
    });
  });

  it("reports the blocker when the target is covered", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/blocked`);
    const view = await substrate.view();
    const covered = refFor(view.refs, "button", "Covered");

    const result = await substrate.act({ ref: covered, do: "click" });

    expect(result).toMatchObject({ ok: false, code: "not_interactive" });
    if (result.ok || result.code !== "not_interactive") {
      throw new Error("expected not_interactive");
    }
    expect(result.blocker_ref).toBeDefined();
    expect(result.blocker_ref).not.toBe(covered);
  });

  it("rejects a fill without a value", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const search = refFor(view.refs, "textbox", "Search");

    expect(await substrate.act({ ref: search, do: "fill" })).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
  });
});
