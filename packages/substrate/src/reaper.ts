import { execFileSync } from "node:child_process";

/** The launch argument that tags a browser with its owning instance. */
export const INSTANCE_ARG = "--portolan-instance";

export type ReapOptions = {
  /** A process is reaped only when its command line also matches this. */
  match?: RegExp;
  /** Defaults to SIGKILL; a browser that ignores SIGTERM should not survive. */
  signal?: NodeJS.Signals;
};

/**
 * Kill browser processes left behind by a dead runtime process.
 *
 * A session's browser is a child of the runtime. If the runtime is killed
 * (SIGKILL, a crashed container, a laptop that slept through a shutdown), the
 * browser is reparented and keeps running. Every engine launched with
 * `instanceId` carries `--portolan-instance=<id>` in its command line, so a
 * new process with the same id can find and kill the orphans before it opens
 * its own browsers.
 *
 * POSIX only: it reads `ps`. On Windows it returns an empty list.
 */
export function reapOrphans(instanceId: string, options: ReapOptions = {}): number[] {
  if (instanceId.trim() === "") {
    throw new Error("instanceId must not be empty");
  }

  if (process.platform === "win32") return [];

  const marker = `${INSTANCE_ARG}=${instanceId}`;
  const listing = execFileSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  const killed: number[] = [];

  for (const line of listing.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const space = trimmed.indexOf(" ");
    if (space < 0) continue;

    const pid = Number(trimmed.slice(0, space));
    const args = trimmed.slice(space + 1);

    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    if (!args.includes(marker)) continue;
    if (options.match !== undefined && !options.match.test(args)) continue;

    try {
      process.kill(pid, options.signal ?? "SIGKILL");
      killed.push(pid);
    } catch {
      // The process exited between the listing and the kill.
    }
  }

  return killed;
}
