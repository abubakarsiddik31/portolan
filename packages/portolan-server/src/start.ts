import { createServer } from "./server.js";
import { SessionStore } from "./store.js";

const port = Number(process.env.PORT ?? 4200);
const store = new SessionStore(process.env.DATABASE_PATH ?? "portolan.db");
const app = createServer({ store, logger: true });

const shutdown = async (): Promise<void> => {
  try {
    await app.close();
  } finally {
    store.closeDatabase();
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
