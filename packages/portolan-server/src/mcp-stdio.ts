import { startStdioServer } from "./stdio.js";

const handle = await startStdioServer();

const shutdown = async (): Promise<void> => {
  try {
    await handle.close();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
