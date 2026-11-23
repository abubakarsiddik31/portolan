import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

import { MapStore } from "@abubakarsiddiik/server";
import {
  type CapabilityLedger,
  type CoverageDiff,
  diffLedgers,
  diffMarkdown,
  diffOps,
  formatDiff,
  type OpsDiff,
  readCapabilities,
  regressions,
} from "@abubakarsiddiik/sources";

export type Git = (args: string[]) => string;

const defaultGit: Git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export type DiffInput = {
  site: string;
  mapsDir: string;
  /** `v3`, or any git ref (`origin/main`). */
  against: string;
  failOn?: string[];
};

export type DiffResult = {
  diff: CoverageDiff;
  ops?: OpsDiff;
  current: CapabilityLedger;
  failures: string[];
  lines: string[];
  markdown: string;
};

/** The ledger as a git ref had it, or undefined when the ref has none. */
export function ledgerAt(
  ref: string,
  ledgerPath: string,
  git: Git = defaultGit,
): CapabilityLedger | undefined {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const path = relative(root, resolve(ledgerPath)).split("\\").join("/");

  try {
    return JSON.parse(git(["show", `${ref}:${path}`])) as CapabilityLedger;
  } catch {
    return undefined;
  }
}

export function runCoverageDiff(input: DiffInput, git: Git = defaultGit): DiffResult {
  const dir = resolve(input.mapsDir, input.site);
  const current = readCapabilities(dir);
  if (current === undefined) {
    throw new Error(`no capabilities.json for "${input.site}" in ${dir}`);
  }

  let base: CapabilityLedger | undefined;
  let ops: OpsDiff | undefined;

  if (/^v\d+$/.test(input.against)) {
    const store = new MapStore(input.mapsDir);
    const before = store.getVersion(input.site, Number(input.against.slice(1)));
    const after = store.get(input.site);
    if (before === undefined) throw new Error(`no ${input.against} for "${input.site}"`);
    if (after !== undefined) ops = diffOps(before, after);
    // A published version carries ops, not a ledger, so the ledger diff is empty.
    base = current;
  } else {
    base = ledgerAt(input.against, resolve(dir, "capabilities.json"), git);
  }

  const diff = diffLedgers(base, current);
  const failures = regressions(diff, input.failOn ?? []);
  return {
    diff,
    ...(ops !== undefined ? { ops } : {}),
    current,
    failures,
    lines: formatDiff(diff, ops),
    markdown: diffMarkdown(input.site, current, diff, failures, ops),
  };
}
