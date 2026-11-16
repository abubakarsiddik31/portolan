import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChrome } from "./chrome.js";
import type { Engine } from "./engine.js";
import { EngineError } from "./engine.js";
import { PlaywrightEngine } from "./playwright-engine.js";
import type { BlockedRequest } from "./policy.js";
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
  <button id="off" disabled>Disabled</button>
  <input id="key" aria-label="Key input" onkeydown="if (event.key === 'Enter') document.getElementById('out').textContent = 'enter:' + this.value">
  <div role="combobox" aria-label="Color" id="combo">Red</div>
  <div role="listbox" id="colors" hidden>
    <div role="option">Red</div>
    <div role="option">Blue</div>
  </div>
  <form>
    <button type="button" id="pick">Pick file</button>
    <input id="resume" type="file" aria-label="Resume file" hidden>
  </form>
  <a href="/download">Download file</a>
  <output id="out"></output>
  <script>
    document.getElementById("combo").addEventListener("click", () => {
      document.getElementById("colors").hidden = false;
    });
    document.getElementById("colors").addEventListener("click", (event) => {
      if (event.target.getAttribute("role") === "option") {
        document.getElementById("combo").textContent = event.target.textContent;
        document.getElementById("colors").hidden = true;
      }
    });
  </script>
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

/**
 * Hydrates late: the title swaps and a fetched record renders well after
 * domcontentloaded. `goto` must not return before both.
 */
const LATE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Loading</title></head>
<body>
  <h1>Late hydration</h1>
  <div id="record"></div>
  <script>
    setTimeout(() => {
      document.title = "Ready";
      fetch("/api/late")
        .then((r) => r.json())
        .then((data) => {
          document.getElementById("record").textContent = data.name;
        });
    }, 600);
  </script>
</body>
</html>`;

/** A button that fetches and re-renders without navigating. */
const SPA = `<!doctype html>
<html lang="en">
<head><title>SPA</title></head>
<body>
  <h1>SPA</h1>
  <button id="load" onclick="fetch('/api/data').then((r) => r.json()).then((data) => { document.getElementById('row').textContent = data.name; })">Load</button>
  <div id="row"></div>
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

describe("substrate act", () => {
  const node = {
    nodeId: "n1",
    role: "button",
    name: "Go",
    backendNodeId: 7,
    ignored: false,
    visible: true,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    properties: {},
    childIds: [],
  };

  it("treats a vanished DOM node as a stale ref", async () => {
    const engine = {
      navigate: async () => ({ url: "http://127.0.0.1/", title: "", status: null }),
      snapshot: async () => ({
        doc: 1,
        v: 0,
        url: "http://127.0.0.1/",
        title: "",
        nodes: [node],
      }),
      dispatch: async () => {
        throw new EngineError("not_found", "no DOM node with backend id 7");
      },
      evaluate: async () => ({ status: 200, text: "{}", json: {}, url: "http://127.0.0.1/" }),
      close: async () => undefined,
    } as unknown as Engine;

    const substrate = new Substrate(engine);
    const view = await substrate.view();
    const ref = refFor(view.refs, "button", "Go");

    expect(await substrate.act({ ref, do: "click" })).toEqual({
      ok: false,
      code: "stale_ref",
      current_doc: 1,
    });
  });
});

describe("substrate read", () => {
  it("captures the page instead of reusing a stale snapshot", async () => {
    let name = "old";
    const engine = {
      navigate: async () => ({ url: "http://x/", title: "", status: null }),
      snapshot: async () => ({
        doc: 1,
        v: 0,
        url: "http://x/",
        title: "",
        nodes: [
          {
            nodeId: "t",
            role: "StaticText",
            name,
            ignored: false,
            visible: true,
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            properties: {},
            childIds: [],
          },
        ],
      }),
      dispatch: async () => ({
        ok: true,
        doc: 1,
        v: 0,
        url: "http://x/",
        title: "",
        effects: [],
      }),
      setFiles: async () => undefined,
      evaluate: async () => ({ status: 200, text: "{}", json: {}, url: "http://x/" }),
      close: async () => undefined,
    } as unknown as Engine;

    const substrate = new Substrate(engine);
    await substrate.view();
    name = "new";

    expect((await substrate.read()).text).toBe("new");
  });
});

describe("substrate fetch redirects", () => {
  function fakeEngine(finalUrl: string): Engine {
    return {
      navigate: async () => ({ url: finalUrl, title: "", status: null }),
      snapshot: async () => ({ doc: 1, v: 0, url: finalUrl, title: "", nodes: [] }),
      dispatch: async () => ({ ok: true, doc: 1, v: 0, url: finalUrl, title: "", effects: [] }),
      evaluate: async () => ({ status: 200, text: "{}", json: {}, url: finalUrl }),
      close: async () => undefined,
    } as unknown as Engine;
  }

  it("refuses a response whose final url is off the allowlist", async () => {
    const events: BlockedRequest[] = [];
    const guarded = new Substrate(fakeEngine("https://evil.test/landing"), {
      policy: { site: "store", allow: ["127.0.0.1"] },
      onBlocked: (event) => events.push(event),
    });

    await expect(guarded.fetch({ method: "GET", url: "http://127.0.0.1/api" })).rejects.toThrow(
      /egress blocked/,
    );
    expect(events[0]).toMatchObject({ reason: "redirect", url: "https://evil.test/landing" });
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const events: BlockedRequest[] = [];
    const guarded = new Substrate(fakeEngine("http://public.test/api"), {
      policy: { site: "store", allow: ["public.test"] },
      onBlocked: (event) => events.push(event),
      resolve: async () => ["127.0.0.1"],
    });

    await expect(guarded.fetch({ method: "GET", url: "http://public.test/api" })).rejects.toThrow(
      /private_address/,
    );
    expect(events[0]?.reason).toBe("private_address");
  });

  it("returns a response whose final url is on the allowlist", async () => {
    const guarded = new Substrate(fakeEngine("http://127.0.0.1/api"), {
      policy: { site: "store", allow: ["127.0.0.1"] },
    });

    await expect(
      guarded.fetch({ method: "GET", url: "http://127.0.0.1/api" }),
    ).resolves.toMatchObject({ status: 200, url: "http://127.0.0.1/api" });
  });
});

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
      if (url === "/download") {
        response.writeHead(200, {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="hello.txt"',
        });
        response.end("hello download");
        return;
      }
      if (url === "/blocked") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(BLOCKED);
        return;
      }
      if (url === "/late") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(LATE);
        return;
      }
      if (url === "/spa") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(SPA);
        return;
      }
      if (url === "/api/late") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"name":"settled record"}');
        return;
      }
      if (url === "/api/data") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"name":"fetched row"}');
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

  it("goto settles a late-hydrating page", async () => {
    const { substrate } = current();
    const view = await substrate.goto(`${baseUrl}/late`);

    expect(view.snapshot.title).toBe("Ready");
    const text = await substrate.read();
    expect(text.text).toContain("settled record");
  });

  it("act settles a fetch-and-rerender click", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/spa`);
    const view = await substrate.view();
    const load = refFor(view.refs, "button", "Load");

    const result = await substrate.act({ ref: load, do: "click" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a successful act");
    expect(result.effects.some((effect) => effect.kind === "network")).toBe(true);
    const text = await substrate.read();
    expect(text.text).toContain("fetched row");
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

  it("blocks an off-allowlist fetch and records it", async () => {
    const { engine } = current();
    const events: BlockedRequest[] = [];
    const guarded = new Substrate(engine, {
      policy: { site: "test", allow: ["127.0.0.1"] },
      onBlocked: (event) => events.push(event),
    });

    await engine.navigate(`${baseUrl}/`);

    await expect(guarded.fetch({ method: "GET", url: `${baseUrl}/api` })).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      guarded.fetch({ method: "POST", url: "https://example.com/collect" }),
    ).rejects.toThrow(/egress blocked/);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      url: "https://example.com/collect",
      method: "POST",
      reason: "not_allowed",
    });
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

  it("reports a disabled target instead of a blocker", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const off = refFor(view.refs, "button", "Disabled");

    expect(await substrate.act({ ref: off, do: "click" })).toEqual({
      ok: false,
      code: "invalid_request",
      message: 'button "Disabled" is disabled',
    });
  });

  it("focuses the target before a key press", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const key = refFor(view.refs, "textbox", "Key input");

    await substrate.act({ ref: key, do: "fill", value: "abc" });
    await engine.evaluate(
      "document.activeElement instanceof HTMLElement && document.activeElement.blur()",
    );

    expect((await substrate.act({ ref: key, do: "press", key: "Enter" })).ok).toBe(true);
    const out = await engine.evaluate<string>("document.getElementById('out')?.textContent ?? ''");
    expect(out).toBe("enter:abc");
  });

  it("selects an option in a custom combobox", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const combo = refFor(view.refs, "combobox", "Color");

    expect((await substrate.act({ ref: combo, do: "select", value: "Blue" })).ok).toBe(true);
    const value = await engine.evaluate<string>(
      "document.getElementById('combo')?.textContent ?? ''",
    );
    expect(value).toBe("Blue");
  });

  it("sets files through a choose-file button", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const pick = refFor(view.refs, "button", "Pick file");
    const file = join(tmpdir(), "portolan-upload.txt");
    writeFileSync(file, "resume");

    expect((await substrate.act({ ref: pick, do: "click", files: [file] })).ok).toBe(true);
    const count = await engine.evaluate<number>(
      "document.getElementById('resume')?.files?.length ?? 0",
    );
    expect(count).toBe(1);
  });

  it("reads the current value of an input", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const key = refFor(view.refs, "textbox", "Key input");

    await substrate.act({ ref: key, do: "fill", value: "abc" });

    expect((await substrate.read(key)).text).toBe("abc");
  });

  it("captures a download", async () => {
    const { engine, substrate } = current();
    await engine.navigate(`${baseUrl}/`);
    const view = await substrate.view();
    const link = refFor(view.refs, "link", "Download file");

    const result = await substrate.act({ ref: link, do: "click" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the download click to succeed");
    expect(result.download?.filename).toBe("hello.txt");
    expect(readFileSync(result.download?.path ?? "", "utf8")).toBe("hello download");
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
    expect(result.blocker_tag).toBe("DIV");
    expect(result.blocker_text).toContain("Accept cookies");
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
