import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildOracleServer } from "./server.js";
import type { Site } from "./sites.js";

const baseURLs: Record<Site, string> = {
  store: process.env.STORE_URL ?? "http://127.0.0.1:4100",
  wizard: process.env.WIZARD_URL ?? "http://127.0.0.1:4101",
  portal: process.env.PORTAL_URL ?? "http://127.0.0.1:4102",
};

const { server, close } = await buildOracleServer({ baseURLs });
const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async (): Promise<void> => {
  await close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
