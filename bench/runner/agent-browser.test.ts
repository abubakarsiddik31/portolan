import { existsSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { AgentBrowserBackend } from "./agent-browser-backend.js";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);
const hasAgentBrowser =
  Boolean(process.env.AGENT_BROWSER_BIN) ||
  existsSync(`${process.cwd()}/bench/node_modules/.bin/agent-browser`);

let storeApp: FastifyInstance;

function portOf(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  return address.port;
}

beforeAll(async () => {
  storeApp = await buildStoreApp();
  await storeApp.listen({ port: 0, host: "127.0.0.1" });
}, 30_000);

afterAll(async () => {
  await storeApp?.close();
});

describe.skipIf(!hasChrome || !hasAgentBrowser)("agent-browser backend", () => {
  it("opens the store, finds a product, and reads the page", async () => {
    const storeURL = `http://127.0.0.1:${portOf(storeApp)}`;
    const backend = new AgentBrowserBackend({
      baseURLs: { store: storeURL, wizard: storeURL, portal: storeURL },
    });

    try {
      const tools = await backend.listTools();
      expect(tools.map((tool) => tool.name)).toContain("snapshot");

      const opened = await backend.openSite("store");
      expect(opened.ok).toBe(true);
      expect(opened.text).toContain("Everyday Tee");

      const found = await backend.callTool("find", {
        locator: "text",
        value: "Everyday Tee",
        action: "click",
      });
      expect(found.ok).toBe(true);

      const url = await backend.callTool("get", { what: "url" });
      expect(url.text).toContain("/p/p_101");

      const read = await backend.callTool("read", {});
      expect(read.text).toContain("Everyday Tee");

      const evaluated = await backend.callTool("evaluate", {
        expression: "document.title",
      });
      const parsed = JSON.parse(evaluated.text) as { value?: unknown };
      expect(String(parsed.value)).toContain("Everyday Tee");
    } finally {
      await backend.close();
    }
  }, 60_000);
});
