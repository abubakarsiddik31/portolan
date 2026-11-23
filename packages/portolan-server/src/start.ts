import { PORTOLAN_DIR } from "@abubakarsiddiik/protocol";
import { reapOrphans } from "@abubakarsiddiik/substrate";

import { assertBindAllowed } from "./host.js";

import { createLogger } from "./log.js";
import { createServer } from "./server.js";
import { SessionStore } from "./store.js";

const port = Number(process.env.PORT ?? 4200);
const store = new SessionStore(process.env.DATABASE_PATH ?? `${PORTOLAN_DIR}/state/portolan.db`);

// A stable id lets a restarted process kill browsers left by a hard-killed
// predecessor. Without one, recovery still closes session rows, but the old
// browsers are left for the operator.
const instanceId = process.env.PORTOLAN_INSTANCE_ID;
if (instanceId !== undefined && instanceId !== "") {
  reapOrphans(instanceId);
}

const log = createLogger({ base: { service: "portolan-server" } });
const host = process.env.HOST ?? "127.0.0.1";
const authToken = process.env.PORTOLAN_AUTH_TOKEN;

assertBindAllowed(host, {
  ...(authToken !== undefined ? { authToken } : {}),
  allowRemote: process.env.PORTOLAN_ALLOW_REMOTE === "1",
});

const app = createServer({
  store,
  logger: true,
  log,
  ...(authToken !== undefined ? { authToken } : {}),
});

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

await app.listen({ port, host });
