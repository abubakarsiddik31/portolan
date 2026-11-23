import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CapabilityCoverage } from "@abubakarsiddiik/sources";

const FILE = "builds.jsonl";

/** One line per build: what was asked, what came of it, and why ops failed. */
export type BuildEntry = {
  at: string;
  site: string;
  duration_ms: number;
  args: Record<string, unknown>;
  coverage_before?: CapabilityCoverage;
  coverage_after?: CapabilityCoverage;
  verified: string[];
  /** Op name to why it did not verify or was held. */
  failed: Record<string, string>;
  published?: number;
  /** The build threw: the message, with nothing else known. */
  error?: string;
};

export function appendBuild(dir: string, entry: BuildEntry): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FILE), `${JSON.stringify(entry)}\n`, "utf8");
}

/** Builds in the order they ran, optionally for one site. */
export function readBuilds(dir: string, site?: string): BuildEntry[] {
  const path = join(dir, FILE);
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as BuildEntry;
        return site === undefined || entry.site === site ? [entry] : [];
      } catch {
        // A torn last line from a killed build must not hide the rest.
        return [];
      }
    });
}
