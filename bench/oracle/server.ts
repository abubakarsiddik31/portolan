import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeOp } from "./execute.js";
import { closeOracleSession, createOracleSession, pageFor } from "./session.js";
import { renderMap, SITES, type Site } from "./sites.js";

export type OracleServerOptions = {
  baseURLs: Record<Site, string>;
  chromePath?: string;
};

export type OracleServer = {
  server: McpServer;
  close: () => Promise<void>;
};

export async function buildOracleServer(options: OracleServerOptions): Promise<OracleServer> {
  const session = await createOracleSession(options);
  let currentSite: Site | undefined;

  const server = new McpServer({ name: "portolan-oracle", version: "0.0.1" });

  server.tool("list_sites", "List the sites this oracle can drive.", {}, async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          Object.entries(SITES).map(([site, info]) => ({
            site,
            description: info.description,
            ops: info.ops.map((op) => op.name),
          })),
        ),
      },
    ],
  }));

  server.tool(
    "open_site",
    "Open a site and return its op map.",
    { site: z.enum(["store", "wizard", "portal"]) },
    async ({ site }) => {
      currentSite = site;
      return { content: [{ type: "text" as const, text: renderMap(site) }] };
    },
  );

  server.tool(
    "call",
    "Call one op on the open site.",
    { op: z.string().min(1), params: z.record(z.string(), z.unknown()).optional() },
    async ({ op, params }) => {
      if (!currentSite) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: "call open_site first" }),
            },
          ],
          isError: true,
        };
      }

      const started = performance.now();
      try {
        const page = await pageFor(session, currentSite);
        const result = await executeOp(currentSite, op, params ?? {}, page);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                site: currentSite,
                op,
                result,
                ms: Math.round(performance.now() - started),
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                site: currentSite,
                op,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return {
    server,
    close: () => closeOracleSession(session),
  };
}
