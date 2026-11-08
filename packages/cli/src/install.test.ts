import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const DOC = join(import.meta.dirname, "../../../docs/INSTALL.md");
const BIN = join(import.meta.dirname, "../dist/bin.js");
const MAPS = join(import.meta.dirname, "../../../maps");
const BUILT = existsSync(BIN);
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-install-"));
  dirs.push(dir);
  return dir;
}

function jsonBlocks(doc: string): unknown[] {
  return [...doc.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(
    (match) => JSON.parse(match[1] ?? "") as unknown,
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("install snippets", () => {
  const doc = readFileSync(DOC, "utf8");

  it("names every supported client", () => {
    for (const client of [
      "Claude Code",
      "Claude Desktop",
      "Codex CLI",
      "Cursor",
      "Gemini CLI",
      "VS Code",
    ]) {
      expect(doc).toContain(client);
    }
  });

  it("every JSON snippet is a stdio portolan server with absolute paths", () => {
    const blocks = jsonBlocks(doc);
    expect(blocks).toHaveLength(5);

    for (const block of blocks) {
      const root = block as {
        mcpServers?: Record<
          string,
          { command: string; args: string[]; env?: Record<string, string> }
        >;
        servers?: Record<
          string,
          { type?: string; command: string; args: string[]; env?: Record<string, string> }
        >;
      };
      const entry = root.servers?.portolan ?? root.mcpServers?.portolan;

      expect(entry, JSON.stringify(block)).toBeDefined();
      expect(entry?.command).toBe("portolan");
      expect(entry?.args).toContain("mcp");
      expect(entry?.env?.MAPS_DIR).toMatch(/^\//);
      expect(entry?.env?.DATABASE_PATH).toMatch(/^\//);

      if (root.servers !== undefined) expect(entry).toMatchObject({ type: "stdio" });
    }
  });

  it("the Codex snippet is a TOML MCP server", () => {
    const toml = /```toml\r?\n([\s\S]*?)```/.exec(doc)?.[1] ?? "";

    expect(toml).toContain("[mcp_servers.portolan]");
    expect(toml).toContain('command = "portolan"');
    expect(toml).toContain('args = ["mcp"]');
    expect(toml).toContain("MAPS_DIR");
  });

  it.skipIf(!BUILT)(
    "the stdio command in the snippets serves the tools",
    async () => {
      const dir = tempDir();
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [BIN, "mcp"],
        env: {
          ...(process.env as Record<string, string>),
          MAPS_DIR: MAPS,
          DATABASE_PATH: join(dir, "sessions.db"),
        },
        stderr: "pipe",
      });

      const client = new Client({ name: "install-test", version: "0.0.1" });
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["open_site", "view", "act", "read", "call"]),
      );

      await client.close();
    },
    60_000,
  );
});
