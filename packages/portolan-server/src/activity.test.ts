import { join } from "node:path";
import type { SemanticNode } from "@abubakarsiddiik/substrate";
import { buildRefMap } from "@abubakarsiddiik/substrate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { type ActivityEvent, ActivityFeed } from "./activity.js";
import { MapStore } from "./maps.js";
import { createMcpServer, type FallbackSubstrate } from "./mcp.js";
import { SessionStore } from "./store.js";

const MAPS = join(import.meta.dirname, "../../../maps");

describe("ActivityFeed", () => {
  it("pairs a call with its result and reads the error code", () => {
    const feed = new ActivityFeed();
    const seen: ActivityEvent[] = [];
    feed.subscribe((event) => seen.push(event));

    const id = feed.call("call", { op: "search", params: { query: "boots" } });
    feed.result(
      id,
      "call",
      {
        content: [
          { type: "text", text: JSON.stringify({ ok: false, error: { code: "unknown_op" } }) },
        ],
        isError: true,
      },
      12,
    );

    expect(seen).toMatchObject([
      { kind: "call", id, tool: "call", args: { op: "search", params: { query: "boots" } } },
      { kind: "result", id, tool: "call", ok: false, code: "unknown_op", ms: 12 },
    ]);
  });

  it("reads the code of a failed act", () => {
    const feed = new ActivityFeed();
    const id = feed.call("act", { ref: "e1", do: "click" });
    feed.result(
      id,
      "act",
      { content: [{ type: "text", text: '{"ok":false,"code":"not_interactive"}' }] },
      4,
    );

    expect(feed.snapshot()[1]).toMatchObject({ ok: false, code: "not_interactive" });
  });

  it("redacts sensitive arguments and credential-shaped responses", () => {
    const feed = new ActivityFeed();
    const id = feed.call("call", { op: "login", params: { password: "hunter2", user: "ann" } });
    feed.result(
      id,
      "call",
      { content: [{ type: "text", text: "token ghp_abcdefghijklmnopqrstuvwx" }] },
      1,
    );

    const [call, result] = feed.snapshot();
    expect(call).toMatchObject({ args: { params: { password: "[redacted]", user: "ann" } } });
    expect(result).toMatchObject({ ok: true, summary: "token [redacted]" });
  });

  it("scrubs a secret the response echoes", () => {
    const feed = new ActivityFeed();
    const id = feed.call("act", { value: "[redacted]" });
    feed.result(id, "act", { content: [{ type: "text", text: '{"value":"s3cret!"}' }] }, 1, [
      "s3cret!",
    ]);

    expect(feed.snapshot()[1]).toMatchObject({ summary: '{"value":"[redacted]"}' });
  });

  it("keeps bounded history and only the latest frame per session", () => {
    const feed = new ActivityFeed({ history: 2 });
    feed.call("a", {});
    feed.call("b", {});
    feed.call("c", {});
    feed.frame("s1", "one", 10, 10);
    feed.frame("s1", "two", 10, 10);

    const events = feed.snapshot();
    expect(events.map((event) => (event.kind === "call" ? event.tool : event.kind))).toEqual([
      "b",
      "c",
      "frame",
    ]);
    expect(events[2]).toMatchObject({ data: "two" });

    feed.page("s1", "closed");
    expect(feed.snapshot().some((event) => event.kind === "frame")).toBe(false);
  });

  it("survives a listener that throws", () => {
    const feed = new ActivityFeed();
    feed.subscribe(() => {
      throw new Error("viewer broke");
    });
    expect(() => feed.call("view", {})).not.toThrow();
  });
});

describe("watched MCP server", () => {
  const PASSWORD: SemanticNode = {
    nodeId: "p",
    role: "textbox",
    name: "Password",
    backendNodeId: 11,
    ignored: false,
    visible: true,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    properties: {},
    childIds: [],
  };

  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function connect(feed: ActivityFeed): Promise<Client> {
    const snapshot = { doc: 1, v: 0, url: "http://127.0.0.1:4100/", title: "", nodes: [PASSWORD] };
    const refs = buildRefMap([PASSWORD], 1);
    const substrate: FallbackSubstrate = {
      view: async () => ({ snapshot, refs }),
      state: () => ({ snapshot, refs }),
      act: async (action) => ({
        ok: true,
        doc: 1,
        v: 1,
        url: "http://127.0.0.1:4100/",
        title: "",
        effects: [],
        delta: { navigation: false, entries: [], typed: action.value },
      }),
      read: async () => ({ text: "page" }),
    };

    const sessions = new SessionStore();
    const server = createMcpServer({
      maps: new MapStore(MAPS),
      sessions,
      substrateFactory: async () => substrate,
      activity: feed,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    close = async () => {
      await client.close();
      await server.close();
      sessions.closeDatabase();
    };
    return client;
  }

  it("records portable and per-site tools with their outcomes", async () => {
    const feed = new ActivityFeed();
    const client = await connect(feed);

    await client.callTool({ name: "list_sites", arguments: {} });
    await client.callTool({ name: "open_site", arguments: { site: "store" } });
    await client.callTool({ name: "call", arguments: { op: "nope" } });

    const events = feed.snapshot();
    const tools = events.filter((event) => event.kind === "call").map((event) => event.tool);
    expect(tools).toEqual(["list_sites", "open_site", "call"]);

    const last = events.at(-1);
    expect(last).toMatchObject({ kind: "result", tool: "call", ok: false, code: "unknown_op" });
  });

  it("blanks a value typed into a password field, in the call and its response", async () => {
    const feed = new ActivityFeed();
    const client = await connect(feed);

    await client.callTool({
      name: "open_url",
      arguments: { url: "http://127.0.0.1:4100/", intent: "sign in" },
    });
    await client.callTool({ name: "view", arguments: {} });
    const ref = buildRefMap([PASSWORD], 1).byNode.get("p")?.ref;
    expect(ref).toBeDefined();
    await client.callTool({ name: "act", arguments: { ref, do: "fill", value: "hunter2" } });

    const serialized = JSON.stringify(feed.snapshot());
    expect(serialized).not.toContain("hunter2");
    expect(
      feed.snapshot().find((event) => event.kind === "call" && event.tool === "act"),
    ).toMatchObject({
      args: { value: "[redacted]" },
    });
  });
});
