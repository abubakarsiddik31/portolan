import { existsSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "../fixtures/portal/v1/app.js";
import { buildStoreApp } from "../fixtures/store/v1/app.js";
import { buildWizardApp } from "../fixtures/wizard/v1/app.js";
import { buildOracleServer } from "./server.js";
import type { Site } from "./sites.js";

const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hasChrome = existsSync(chromePath);

let storeApp: FastifyInstance;
let wizardApp: FastifyInstance;
let portalApp: FastifyInstance;
let closeOracle: (() => Promise<void>) | undefined;

function portOf(app: FastifyInstance): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  return address.port;
}

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      typeof item === "object" && item !== null && "text" in item
        ? String((item as { text: unknown }).text)
        : "",
    )
    .join("\n");
}

beforeAll(async () => {
  storeApp = await buildStoreApp();
  wizardApp = await buildWizardApp();
  portalApp = await buildPortalApp();
  await Promise.all([
    storeApp.listen({ port: 0, host: "127.0.0.1" }),
    wizardApp.listen({ port: 0, host: "127.0.0.1" }),
    portalApp.listen({ port: 0, host: "127.0.0.1" }),
  ]);
}, 30_000);

afterAll(async () => {
  await closeOracle?.();
  await storeApp?.close();
  await wizardApp?.close();
  await portalApp?.close();
});

describe.skipIf(!hasChrome)("oracle mcp server", () => {
  it("lists sites, opens one, and calls ops over mcp", async () => {
    const baseURLs: Record<Site, string> = {
      store: `http://127.0.0.1:${portOf(storeApp)}`,
      wizard: `http://127.0.0.1:${portOf(wizardApp)}`,
      portal: `http://127.0.0.1:${portOf(portalApp)}`,
    };
    const oracle = await buildOracleServer({ baseURLs, chromePath });
    closeOracle = oracle.close;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await oracle.server.connect(serverTransport);

    const client = new Client({ name: "oracle-test", version: "0.0.1" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_sites", "open_site", "call"]),
    );

    const sites = await client.callTool({ name: "list_sites", arguments: {} });
    expect(textOf(sites)).toContain("store");

    const opened = await client.callTool({
      name: "open_site",
      arguments: { site: "store" },
    });
    expect(textOf(opened)).toContain("add_to_cart");

    const found = await client.callTool({
      name: "call",
      arguments: { op: "search", params: { query: "socks" } },
    });
    expect(textOf(found)).toContain("Merino Socks");

    await client.callTool({
      name: "call",
      arguments: {
        op: "add_to_cart",
        params: { product_id: "p_101", variant_id: "v_101_m_blue", qty: 2 },
      },
    });
    const cart = await client.callTool({
      name: "call",
      arguments: { op: "view_cart", params: {} },
    });
    expect(textOf(cart)).toContain("$48.00");

    await client.close();
    await oracle.server.close();
  }, 60_000);
});
