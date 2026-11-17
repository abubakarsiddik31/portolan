import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, SessionStore } from "@abubakarsiddiik/server";
import { findChrome, reapOrphans } from "@abubakarsiddiik/substrate";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const CHILD = join(import.meta.dirname, "child.ts");
const LOADER = join(ROOT, "bench/node_modules/tsx/dist/loader.mjs");
const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined &&
  existsSync(LOADER) &&
  process.platform !== "win32" &&
  (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

const dirs: string[] = [];
const children: ChildProcess[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-lifecycle-"));
  dirs.push(dir);
  return dir;
}

function waitFor(path: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (existsSync(path)) {
        resolve(readFileSync(path, "utf8"));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`${path} was not written within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function killed(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

async function untilGone(instanceId: string, timeoutMs = 5_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let last: number[] = [];

  while (Date.now() < deadline) {
    last = reapOrphans(instanceId);
    if (last.length === 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return last;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await killed(child);
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("session lifecycle after a hard kill", () => {
  it("reaps the orphan browser and recovers the session", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "sessions.db");
    const readyPath = join(dir, "ready.json");
    const instanceId = `lifecycle-${randomUUID()}`;

    // Run the child as `node` itself (not through the tsx wrapper), so the
    // SIGKILL lands on the process that owns the browser.
    const child = spawn(
      process.execPath,
      ["--import", LOADER, CHILD, dbPath, readyPath, CHROME as string, instanceId],
      { stdio: "inherit" },
    );
    children.push(child);

    const ready = JSON.parse(await waitFor(readyPath)) as {
      pid: number;
      sid: string;
      instanceId: string;
    };
    expect(ready.instanceId).toBe(instanceId);

    // The session is open and the browser is live before the kill.
    const before = new SessionStore(dbPath);
    expect(before.get(ready.sid)?.closed_at).toBeUndefined();
    before.closeDatabase();

    child.kill("SIGKILL");
    await killed(child);

    // The browser outlived its parent; the reaper finds it by its tag.
    const reaped = await untilGone(instanceId);
    expect(reaped).toEqual([]);

    // A new process closes the stale session at startup.
    const store = new SessionStore(dbPath);
    const http = createServer({ store, recoverSessions: true });
    expect(store.get(ready.sid)?.closed_at).toBeTypeOf("string");
    expect(store.countOpen()).toBe(0);

    await http.close();
    store.closeDatabase();
  }, 60_000);
});
