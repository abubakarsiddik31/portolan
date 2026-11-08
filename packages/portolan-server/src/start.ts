import { reapOrphans } from "@portolan/substrate";

import { createServer } from "./server.js";
import { SessionStore } from "./store.js";

const port = Number(process.env.PORT ?? 4200);
const store = new SessionStore(process.env.DATABASE_PATH ?? "portolan.db");

// A stable id lets a restarted process kill browsers left by a hard-killed
// predecessor. Without one, recovery still closes session rows, but the old
// browsers are left for the operator.
const instanceId = process.env.PORTOLAN_INSTANCE_ID;
if (instanceId !== undefined && instanceId !== "") {
  reapOrphans(instanceId);
}

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
