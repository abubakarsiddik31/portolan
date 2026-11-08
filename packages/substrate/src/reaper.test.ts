import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { reapOrphans } from "./reaper.js";

const children: ReturnType<typeof spawn>[] = [];

function sleeper(marker: string): ReturnType<typeof spawn> {
  const child = spawn(process.execPath, ["-e", `setInterval(() => {}, 1000); // ${marker}`], {
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

async function started(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.pid !== undefined) resolve();
    else child.once("spawn", () => resolve());
  });
  // The process is visible to `ps` a moment after spawn resolves.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function exited(child: ReturnType<typeof spawn>): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    child.once("exit", () => resolve(true));
    setTimeout(() => resolve(false), 2_000).unref();
  });
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

describe.skipIf(process.platform === "win32")("reapOrphans", () => {
  it("kills a process tagged with the instance id", async () => {
    const instance = randomUUID();
    const child = sleeper(`--portolan-instance=${instance}`);
    await started(child);

    const killed = reapOrphans(instance);

    expect(killed).toContain(child.pid);
    expect(await exited(child)).toBe(true);
  });

  it("leaves a process with another instance id alone", async () => {
    const mine = randomUUID();
    const other = sleeper(`--portolan-instance=${randomUUID()}`);
    await started(other);

    expect(reapOrphans(mine)).toEqual([]);
    expect(other.exitCode).toBeNull();
  });

  it("rejects an empty instance id", () => {
    expect(() => reapOrphans("  ")).toThrow(/must not be empty/);
  });
});
