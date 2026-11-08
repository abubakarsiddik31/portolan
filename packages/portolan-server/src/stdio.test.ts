import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { type StdioServerHandle, startStdioServer } from "./stdio.js";

const MAPS = join(import.meta.dirname, "../../../maps");
const handles: StdioServerHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
});

describe("startStdioServer", () => {
  it("serves the MCP tool surface over a transport", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = await startStdioServer({
      mapsDir: MAPS,
      databasePath: ":memory:",
      transport: serverTransport,
    });
    handles.push(handle);

    const client = new Client({ name: "stdio-test", version: "0.0.1" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining(["open_site", "view", "act", "read", "call", "fallback_done"]),
    );

    await client.close();
  });
});
