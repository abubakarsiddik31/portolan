import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { MapStore } from "./maps.js";
import { createMcpServer, type MappingTools } from "./mcp.js";
import { SessionStore } from "./store.js";

const MAPS = join(import.meta.dirname, "../../../maps");

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("");
}

describe("mapping tools over MCP", () => {
  const closers: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  async function connect(mapping?: MappingTools): Promise<Client> {
    const sessions = new SessionStore();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      maps: new MapStore(MAPS),
      sessions,
      ...(mapping !== undefined ? { mapping } : {}),
    });
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    closers.push(
      () => client.close(),
      () => server.close(),
      () => sessions.closeDatabase(),
    );
    return client;
  }

  function tools(calls: string[]): MappingTools {
    return {
      status: async (site) => {
        calls.push(`status ${site}`);
        return { site, next: ["portolan map record --gaps"] };
      },
      gaps: async (input) => {
        calls.push(`gaps ${input.offset}/${input.limit}/${input.status ?? "-"}`);
        return { total: 3, offset: input.offset, items: [] };
      },
      setCapability: async (input) => {
        calls.push(`set ${input.id} ${input.status}`);
        return { id: input.id, status: input.status };
      },
      recordGaps: async (input) => {
        calls.push(`record ${input.site} ${input.max ?? "-"}`);
        return { counts: { recorded: 1 } };
      },
      startBuild: (input) => {
        calls.push(`build ${input.site} verify=${input.verify} publish=${input.publish}`);
        return { job: "job_1" };
      },
      job: (id) => (id === "job_1" ? { state: "done", summary: { verified: 3 } } : undefined),
    };
  }

  it("lists the loop's tools only when the host provides them", async () => {
    const without = await connect();
    expect((await without.listTools()).tools.map((tool) => tool.name)).not.toContain("map_status");

    const client = await connect(tools([]));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of [
      "map_status",
      "map_gaps",
      "capability_set",
      "map_record_gaps",
      "map_build",
      "map_job",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("reads status and gaps, and passes paging through", async () => {
    const calls: string[] = [];
    const client = await connect(tools(calls));

    const status = JSON.parse(
      textOf(await client.callTool({ name: "map_status", arguments: { site: "app" } })),
    );
    expect(status.result.next).toEqual(["portolan map record --gaps"]);
    expect(status.untrusted).toBe(true);

    await client.callTool({
      name: "map_gaps",
      arguments: { site: "app", status: "stale", offset: 25, limit: 10 },
    });
    expect(calls).toEqual(["status app", "gaps 25/10/stale"]);
  });

  it("refuses to run a browser or a build without confirm: true", async () => {
    const calls: string[] = [];
    const client = await connect(tools(calls));

    for (const name of ["map_record_gaps", "map_build"]) {
      const result = await client.callTool({ name, arguments: { site: "app" } });
      expect(result.isError).toBe(true);
      expect(JSON.parse(textOf(result)).error.code).toBe("needs_confirmation");
    }
    expect(calls).toEqual([]);

    await client.callTool({
      name: "map_record_gaps",
      arguments: { site: "app", confirm: true, max: 5 },
    });
    const started = JSON.parse(
      textOf(
        await client.callTool({
          name: "map_build",
          arguments: { site: "app", confirm: true, publish: true },
        }),
      ),
    );
    expect(started.result.job).toBe("job_1");
    expect(calls).toEqual(["record app 5", "build app verify=true publish=true"]);

    const job = JSON.parse(
      textOf(await client.callTool({ name: "map_job", arguments: { job: "job_1" } })),
    );
    expect(job.result.state).toBe("done");
    const missing = await client.callTool({ name: "map_job", arguments: { job: "nope" } });
    expect(missing.isError).toBe(true);
  });

  it("needs a reason to exclude a capability", async () => {
    const calls: string[] = [];
    const client = await connect(tools(calls));

    const bare = await client.callTool({
      name: "capability_set",
      arguments: { site: "app", id: "home.button.x", status: "excluded" },
    });
    expect(bare.isError).toBe(true);

    await client.callTool({
      name: "capability_set",
      arguments: { site: "app", id: "home.button.x", status: "excluded", reason: "paid" },
    });
    expect(calls).toEqual(["set home.button.x excluded"]);
  });
});
