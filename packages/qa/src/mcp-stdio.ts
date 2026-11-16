import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadQaConfig } from "./config.js";
import { createQaMcpServer } from "./mcp.js";
import { QaService } from "./service.js";

/**
 * stdio entry point. stdout belongs to the protocol, so nothing is printed.
 */
const { config } = loadQaConfig();
const service = new QaService(config);
const server = createQaMcpServer(service);

await server.connect(new StdioServerTransport());

const shutdown = async (): Promise<void> => {
  try {
    await server.close();
    service.close();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
