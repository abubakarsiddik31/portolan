import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChrome } from "./chrome.js";
import type { Snapshot } from "./engine.js";
import { PlaywrightEngine } from "./playwright-engine.js";

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Engine test</title></head>
<body>
  <h1>Engine test</h1>
  <label for="q">Search</label>
  <input id="q" name="q">
  <button id="go" onclick="document.getElementById('out').textContent = document.getElementById('q').value">Go</button>
  <label for="size">Size</label>
  <select id="size">
    <option value="s">Small</option>
    <option value="m">Medium</option>
  </select>
  <label><input id="terms" type="checkbox"> I agree</label>
  <output id="out"></output>
</body>
</html>`;

const CHROME = findChrome();

/**
 * Browser tests run locally, where a usable Chrome is installed. The CI
 * runner exposes a Chrome binary that cannot launch in the container, so the
 * suite is opt-in there with PORTOLAN_BROWSER_TESTS=1.
 */
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function chromePath(): string {
  if (CHROME === undefined) throw new Error("Chrome is required");
  return CHROME;
}

function target(snapshot: Snapshot, role: string, name: string): number {
  const node = snapshot.nodes.find(
    (candidate) => candidate.role === role && candidate.name === name,
  );

  if (node?.backendNodeId === undefined) {
    throw new Error(`no ${role} named "${name}"`);
  }

  return node.backendNodeId;
}

describe.skipIf(!ENABLED)("playwright engine", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let engine: PlaywrightEngine | undefined;

  function current(): PlaywrightEngine {
    if (engine === undefined) throw new Error("the engine is not running");
    return engine;
  }

  beforeAll(async () => {
    const started = createServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(PAGE);
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
    baseUrl = `http://127.0.0.1:${address.port}/`;

    engine = await PlaywrightEngine.launch({
      executablePath: chromePath(),
      launchArgs: process.env.CI === "true" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
    });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  it("navigates and reports the title", async () => {
    const result = await current().navigate(baseUrl);

    expect(result.url).toBe(baseUrl);
    expect(result.title).toBe("Engine test");
    expect(result.status).toBe(200);
  });

  it("snapshots the accessibility tree", async () => {
    await current().navigate(baseUrl);
    const snapshot = await current().snapshot();
    const roles = snapshot.nodes.map((node) => node.role);

    expect(roles).toContain("heading");
    expect(roles).toContain("textbox");
    expect(roles).toContain("button");
    expect(roles).toContain("combobox");
    expect(roles).toContain("checkbox");
    expect(target(snapshot, "textbox", "Search")).toBeTypeOf("number");
  });

  it("fills an input and clicks a button", async () => {
    const running = current();
    await running.navigate(baseUrl);
    const snapshot = await running.snapshot();

    await running.dispatch({
      do: "fill",
      backendNodeId: target(snapshot, "textbox", "Search"),
      value: "tee",
    });
    await running.dispatch({
      do: "click",
      backendNodeId: target(snapshot, "button", "Go"),
    });

    await expect(
      running.evaluate<string>("document.getElementById('out').textContent"),
    ).resolves.toBe("tee");
  });

  it("selects an option", async () => {
    const running = current();
    await running.navigate(baseUrl);
    const snapshot = await running.snapshot();

    await running.dispatch({
      do: "select",
      backendNodeId: target(snapshot, "combobox", "Size"),
      value: "m",
    });

    await expect(running.evaluate<string>("document.getElementById('size').value")).resolves.toBe(
      "m",
    );
  });

  it("checks and unchecks a checkbox", async () => {
    const running = current();
    await running.navigate(baseUrl);
    const snapshot = await running.snapshot();
    const box = target(snapshot, "checkbox", "I agree");

    await running.dispatch({ do: "check", backendNodeId: box });
    await expect(
      running.evaluate<boolean>("document.getElementById('terms').checked"),
    ).resolves.toBe(true);

    await running.dispatch({ do: "uncheck", backendNodeId: box });
    await expect(
      running.evaluate<boolean>("document.getElementById('terms').checked"),
    ).resolves.toBe(false);
  });

  it("throws a typed error for a missing node", async () => {
    await expect(current().dispatch({ do: "click", backendNodeId: 999_999 })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
});
