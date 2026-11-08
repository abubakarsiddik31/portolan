import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MapStore } from "./maps.js";
import { createMcpServer } from "./mcp.js";
import { SessionStore } from "./store.js";

const maps = new MapStore(process.env.MAPS_DIR ?? "maps");
const sessions = new SessionStore(process.env.DATABASE_PATH ?? "portolan.db");
const server = createMcpServer({ maps, sessions });
const transport = new StdioServerTransport();

const shutdown = async (): Promise<void> => {
  try {
    await server.close();
  } finally {
    sessions.closeDatabase();
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(transport);
