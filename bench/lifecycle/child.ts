import { writeFileSync } from "node:fs";

import { SessionStore } from "@portolan/server";
import { PlaywrightEngine } from "@portolan/substrate";

/**
 * A child process that holds a session and a live browser.
 *
 * The lifecycle test kills this process with SIGKILL, so it never runs an
 * exit handler: the session row and the browser are both orphaned. The parent
 * then proves the next process can reap the browser and recover the session.
 */
async function main(): Promise<void> {
  const [dbPath, readyPath, executablePath, instanceId] = process.argv.slice(2);

  if (
    dbPath === undefined ||
    readyPath === undefined ||
    executablePath === undefined ||
    instanceId === undefined
  ) {
    throw new Error("usage: child.ts <db> <ready> <chrome> <instance>");
  }

  const store = new SessionStore(dbPath);
  const session = store.create({ site: "lifecycle" });

  const engine = await PlaywrightEngine.launch({ executablePath, instanceId });
  await engine.navigate("data:text/html,<h1>lifecycle</h1>");

  writeFileSync(readyPath, JSON.stringify({ pid: process.pid, sid: session.sid, instanceId }));

  // Stay alive until the parent kills us.
  setInterval(() => {}, 1_000);
}

await main();
