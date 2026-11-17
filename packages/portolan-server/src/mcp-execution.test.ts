import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRefMap,
  type SemanticNode,
  type Snapshot,
  type Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { MapStore } from "./maps.js";
import { createMcpServer } from "./mcp.js";
import { SessionStore } from "./store.js";

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mapsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-exec-"));
  dirs.push(dir);
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(
    join(dir, "test", "v1.json"),
    JSON.stringify({
      site: "test",
      origins: ["http://x"],
      version: 1,
      states: [{ id: "home", marks: [{ role: "heading", name: "Home" }] }],
      ops: [
        {
          name: "read_url",
          version: 1,
          summary: "Read a widget.",
          params: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
            additionalProperties: false,
          },
          returns: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
          from: ["home"],
          to: ["home"],
          post: [],
          effect: "read",
          impls: [
            {
              tier: "url",
              route: "/item/{id}",
              extract: { kind: "fields", fields: { title: { role: "heading", name: "Widget" } } },
            },
          ],
          status: "verified",
        },
        {
          name: "write_ui",
          version: 1,
          summary: "Click Go.",
          params: { type: "object", properties: {}, additionalProperties: false },
          returns: { type: "object", properties: {}, additionalProperties: false },
          from: ["home"],
          to: ["home"],
          post: [],
          effect: "irreversible",
          confirm: true,
          impls: [
            {
              tier: "ui",
              steps: [{ do: "click", target: { role: "button", name: "Go" } }],
              extract: { kind: "none" },
            },
          ],
          status: "verified",
        },
      ],
      entities: {},
      compiled_from: [],
      verified_at: "2026-11-09T00:00:00Z",
    }),
  );
  return dir;
}

function node(name: string, role = "heading"): SemanticNode {
  return {
    nodeId: `${role}:${name}`,
    role,
    name,
    backendNodeId: 1,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
  };
}

function view(nodes: SemanticNode[], url: string): SubstrateView {
  const snapshot: Snapshot = { doc: 1, v: 0, url, title: "", nodes };
  return { snapshot, refs: buildRefMap(nodes, 1) };
}

const HOME = view([node("Home"), node("Go", "button")], "http://x/");
const WIDGET = view([node("Widget")], "http://x/item/1");

function fakeSubstrate(): Substrate {
  let current = HOME;

  return {
    view: async () => current,
    state: () => current,
    goto: async () => {
      current = WIDGET;
      return current;
    },
    fetch: async () => ({ status: 200, text: "{}", json: {} }),
    act: async () => ({ ok: true, effects: [] }),
    read: async () => ({ text: "" }),
  } as unknown as Substrate;
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

describe("mcp execution", () => {
  it("executes a read op through the default executor", async () => {
    const sessions = new SessionStore();
    const server = createMcpServer({
      maps: new MapStore(mapsDir()),
      sessions,
      substrateFactory: async () => fakeSubstrate(),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "exec", version: "0.0.0" });
    await client.connect(clientTransport);

    closers.push(async () => {
      await client.close();
      await server.close();
      sessions.closeDatabase();
    });

    await client.callTool({ name: "open_site", arguments: { site: "test" } });
    const result = JSON.parse(
      textOf(
        await client.callTool({ name: "call", arguments: { op: "read_url", params: { id: "1" } } }),
      ),
    ) as { ok: boolean; result?: { title: string }; untrusted?: boolean };

    expect(result).toMatchObject({ ok: true, result: { title: "Widget" }, untrusted: true });
  });

  it("requires confirmation for a write and then runs it", async () => {
    const sessions = new SessionStore();
    const server = createMcpServer({
      maps: new MapStore(mapsDir()),
      sessions,
      substrateFactory: async () => fakeSubstrate(),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "exec-write", version: "0.0.0" });
    await client.connect(clientTransport);

    closers.push(async () => {
      await client.close();
      await server.close();
      sessions.closeDatabase();
    });

    await client.callTool({ name: "open_site", arguments: { site: "test" } });

    const first = JSON.parse(
      textOf(await client.callTool({ name: "call", arguments: { op: "write_ui" } })),
    ) as { ok: boolean; error?: { code: string } };
    expect(first).toMatchObject({ ok: false, error: { code: "needs_confirmation" } });

    const second = JSON.parse(
      textOf(
        await client.callTool({
          name: "call",
          arguments: { op: "write_ui", confirm: true, idempotency_key: "k1" },
        }),
      ),
    ) as { ok: boolean };
    expect(second.ok).toBe(true);
  });
});
