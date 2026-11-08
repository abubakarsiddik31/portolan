import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpExecutor, OpExecutorInput } from "./executor.js";
import { MapStore } from "./maps.js";
import { createMcpServer } from "./mcp.js";
import { SessionStore } from "./store.js";

const MAPS = join(import.meta.dirname, "../../../maps");

type ToolResult = {
  ok?: boolean;
  error?: { code: string; message?: string; details?: { issues?: unknown[] } };
};

describe("mcp surface", () => {
  let sessions: SessionStore;
  let client: Client | undefined;
  let server: McpServer | undefined;
  let calls: OpExecutorInput[];

  const executor: OpExecutor = async (input) => {
    calls.push(input);
    return { ok: true, result: { op: input.op.name, params: input.params } };
  };

  beforeEach(async () => {
    sessions = new SessionStore();
    calls = [];

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer({ maps: new MapStore(MAPS), sessions, executor });
    await server.connect(serverTransport);

    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    if (client !== undefined) await client.close();
    if (server !== undefined) await server.close();
    sessions.closeDatabase();
  });

  async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (client === undefined) throw new Error("the client is not connected");
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse(textOf(result));
  }

  it("lists the three tools", async () => {
    if (client === undefined) throw new Error("the client is not connected");
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual(["list_sites", "open_site", "call"]);
  });

  it("lists the fixture sites", async () => {
    const sites = (await call("list_sites")) as Array<{ site: string }>;

    expect(sites.map((site) => site.site)).toEqual(["portal", "store", "wizard"]);
  });

  it("opens a site and pins its map version", async () => {
    const opened = (await call("open_site", { site: "store" })) as {
      sid: string;
      map_version: number;
      map: string;
    };

    expect(opened.map_version).toBe(1);
    expect(opened.map).toContain("search(");
    expect(opened.sid).toBeTypeOf("string");
  });

  it("rejects an unknown site", async () => {
    const result = (await call("open_site", { site: "nope" })) as ToolResult;

    expect(result).toMatchObject({ ok: false, error: { code: "map_not_found" } });
  });

  it("requires open_site before call", async () => {
    const result = (await call("call", {
      op: "search",
      params: { query: "tee" },
    })) as ToolResult;

    expect(result).toMatchObject({
      ok: false,
      error: { code: "session_not_found" },
    });
  });

  it("reaches the executor with a valid call", async () => {
    await call("open_site", { site: "store" });

    const result = (await call("call", {
      op: "search",
      params: { query: "tee" },
    })) as ToolResult;

    expect(result).toEqual({
      ok: true,
      result: { op: "search", params: { query: "tee" } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.op.name).toBe("search");
  });

  it("rejects an unknown op", async () => {
    await call("open_site", { site: "store" });

    const result = (await call("call", { op: "nope" })) as ToolResult;

    expect(result).toMatchObject({ ok: false, error: { code: "unknown_op" } });
  });

  it("rejects invalid params with issues", async () => {
    await call("open_site", { site: "store" });

    const result = (await call("call", { op: "search", params: {} })) as ToolResult;

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_params" },
    });
    expect(result.error?.details?.issues?.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it("requires confirmation for an irreversible op", async () => {
    await call("open_site", { site: "store" });

    const result = (await call("call", {
      op: "checkout",
      params: {
        name: "Ada",
        email: "ada@example.com",
        address: "1 Way",
        city: "London",
        postal: "N1",
        card: "4242424242424242",
      },
    })) as ToolResult;

    expect(result).toMatchObject({
      ok: false,
      error: { code: "needs_confirmation" },
    });
    expect(calls).toHaveLength(0);
  });

  it("reaches the executor when confirmed", async () => {
    await call("open_site", { site: "store" });

    const result = (await call("call", {
      op: "checkout",
      confirm: true,
      params: {
        name: "Ada",
        email: "ada@example.com",
        address: "1 Way",
        city: "London",
        postal: "N1",
        card: "4242424242424242",
      },
    })) as ToolResult;

    expect(result).toMatchObject({ ok: true, result: { op: "checkout" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.confirm).toBe(true);
  });
});

function textOf(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    return "";
  }

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
