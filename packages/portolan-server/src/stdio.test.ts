import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildRefMap, type SemanticNode, type Snapshot } from "@portolan/substrate";
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

  it("serves view through the substrate factory", async () => {
    const node: SemanticNode = {
      nodeId: "button:Go",
      role: "button",
      name: "Go",
      backendNodeId: 1,
      ignored: false,
      visible: true,
      properties: {},
      childIds: [],
      bounds: { x: 0, y: 0, width: 40, height: 20 },
    };
    const snapshot: Snapshot = { doc: 1, v: 0, url: "http://x/", title: "", nodes: [node] };
    const view = { snapshot, refs: buildRefMap([node], 1) };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = await startStdioServer({
      mapsDir: MAPS,
      databasePath: ":memory:",
      transport: serverTransport,
      substrateFactory: () => ({
        view: async () => view,
        state: () => view,
        read: async () => ({ text: "Go" }),
        act: async () => ({ ok: false, code: "invalid_request", message: "not in this test" }),
      }),
    });
    handles.push(handle);

    const client = new Client({ name: "stdio-view", version: "0.0.1" });
    await client.connect(clientTransport);
    await client.callTool({ name: "open_site", arguments: { site: "store" } });

    const result = await client.callTool({
      name: "view",
      arguments: { format: "both" },
    });
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    const body = JSON.parse(text) as {
      untrusted: boolean;
      affordances: Array<{ name: string }>;
    };

    expect(body.untrusted).toBe(true);
    expect(body.affordances).toContainEqual(expect.objectContaining({ name: "Go" }));

    await client.close();
  });
});
