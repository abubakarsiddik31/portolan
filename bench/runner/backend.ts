import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { ToolBackend, ToolDef, ToolResult } from "./types.js";

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

export class McpBackend implements ToolBackend {
  constructor(private readonly client: Client) {}

  async listTools(): Promise<ToolDef[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    return {
      ok: result.isError !== true,
      text: textOf(result),
      raw: result,
    };
  }

  async openSite(site: string): Promise<ToolResult> {
    return this.callTool("open_site", { site });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export async function createStdioBackend(options: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<McpBackend> {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...options.env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    env,
  });
  const client = new Client({ name: "portolan-runner", version: "0.0.1" });
  await client.connect(transport);
  return new McpBackend(client);
}
