import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TraceStore } from "@abubakarsiddiik/runtime";
import { MapStore } from "@abubakarsiddiik/server";
import {
  type CapabilityCoverage,
  coverageOf,
  formatCoverage,
  gapsOf,
  readCapabilities,
} from "@abubakarsiddiik/sources";

import { recipePath } from "./auth.js";
import { describeExpiry, sessionExpiry } from "./auth-recipe.js";
import { readBuilds } from "./journal.js";

export type StatusInput = {
  site: string;
  mapsDir: string;
  tracesDir: string;
  journalDir: string;
  storageState?: string;
  now?: number;
};

export type MapStatus = {
  site: string;
  version?: number;
  ops: number;
  coverage?: CapabilityCoverage;
  gaps: number;
  uncompiled_traces: Array<{ scope_id: string; intent: string; capability?: string }>;
  last_build?: {
    at: string;
    duration_ms: number;
    verified: number;
    published?: number;
    error?: string;
    failures: Array<{ reason: string; ops: string[] }>;
  };
  auth?: { path: string; state: string; refreshable: boolean };
  next: string[];
};

/** Where the mapping loop stands, from the files it already keeps. */
export async function mapStatus(input: StatusInput): Promise<MapStatus> {
  const now = input.now ?? Date.now();
  const map = new MapStore(input.mapsDir).get(input.site);
  const ledger = readCapabilities(join(input.mapsDir, input.site));
  const coverage = ledger === undefined ? undefined : coverageOf(ledger);
  const gaps = ledger === undefined ? 0 : gapsOf(ledger).length;

  const traces = await new TraceStore(input.tracesDir).all().catch(() => []);
  const compiled = new Set(map?.compiled_from ?? []);
  const uncompiled = traces
    .filter((trace) => !compiled.has(trace.scope_id))
    .map((trace) => ({
      scope_id: trace.scope_id,
      intent: trace.intent,
      ...(trace.capability !== undefined ? { capability: trace.capability } : {}),
    }));

  const builds = readBuilds(input.journalDir, input.site);
  const last = builds[builds.length - 1];

  const status: MapStatus = {
    site: input.site,
    ...(map !== undefined ? { version: map.version } : {}),
    ops: map?.ops.length ?? 0,
    ...(coverage !== undefined ? { coverage } : {}),
    gaps,
    uncompiled_traces: uncompiled,
    ...(last !== undefined
      ? {
          last_build: {
            at: last.at,
            duration_ms: last.duration_ms,
            verified: last.verified.length,
            ...(last.published !== undefined ? { published: last.published } : {}),
            ...(last.error !== undefined ? { error: last.error } : {}),
            failures: groupFailures(last.failed),
          },
        }
      : {}),
    next: [],
  };

  if (input.storageState !== undefined) {
    status.auth = authOf(input.storageState, now);
  }

  status.next = nextSteps(status, input);
  return status;
}

function groupFailures(failed: Record<string, string>): Array<{ reason: string; ops: string[] }> {
  const groups = new Map<string, string[]>();

  for (const [op, message] of Object.entries(failed)) {
    const reason = message
      .split(op)
      .join("<op>")
      .replace(/^<op> did not verify: /, "");
    groups.set(reason, [...(groups.get(reason) ?? []), op]);
  }

  return [...groups]
    .map(([reason, ops]) => ({ reason, ops }))
    .sort((a, b) => b.ops.length - a.ops.length);
}

function authOf(path: string, now: number): NonNullable<MapStatus["auth"]> {
  if (!existsSync(path)) return { path, state: "no session", refreshable: false };

  let state = "saved";
  try {
    const expiresAt = sessionExpiry(JSON.parse(readFileSync(path, "utf8")));
    if (expiresAt !== undefined) state = describeExpiry(expiresAt, now);
  } catch {
    state = "unreadable";
  }
  return { path, state, refreshable: existsSync(recipePath(path)) };
}

function nextSteps(status: MapStatus, input: StatusInput): string[] {
  const site = `--site ${status.site}`;
  const steps: string[] = [];

  if (status.auth !== undefined && /expired|no session/.test(status.auth.state)) {
    steps.push(
      status.auth.refreshable
        ? `portolan auth refresh --out ${status.auth.path}`
        : `portolan auth login --url <sign-in page> --out ${status.auth.path}`,
    );
  }
  if (status.version === undefined && status.uncompiled_traces.length === 0) {
    steps.push(`portolan map build ${site} --url <app url> --verify --publish`);
    return steps;
  }
  if (status.last_build?.error !== undefined) {
    steps.push(
      `fix the last build's error, then rerun it: ${status.last_build.error.split("\n")[0]}`,
    );
  }
  if (status.uncompiled_traces.length > 0) {
    steps.push(
      `portolan map build ${site} --traces-dir ${input.tracesDir} --verify --publish  (${status.uncompiled_traces.length} recorded runs not compiled)`,
    );
  }
  if ((status.coverage?.missing ?? 0) > 0) {
    steps.push(`portolan map record --gaps ${site}  (${status.coverage?.missing} missing)`);
  }
  if (status.last_build !== undefined && status.last_build.failures.length > 0) {
    steps.push(
      `look at the ${status.last_build.failures.length} failure reason(s) in the last build, then rerun with --verify`,
    );
  }
  if (steps.length === 0)
    steps.push(
      `nothing to do: ${status.coverage === undefined ? "map is built" : formatCoverage(status.coverage)}`,
    );
  return steps;
}

export function formatStatus(status: MapStatus): string[] {
  const lines = [
    `${status.site}: ${status.version === undefined ? "no published map" : `v${status.version}, ${status.ops} ops`}`,
  ];
  if (status.coverage !== undefined) lines.push(`  coverage: ${formatCoverage(status.coverage)}`);
  if (status.uncompiled_traces.length > 0) {
    lines.push(`  ${status.uncompiled_traces.length} recorded runs not compiled`);
  }
  if (status.last_build !== undefined) {
    const build = status.last_build;
    lines.push(
      `  last build ${build.at} (${Math.round(build.duration_ms / 1000)}s): ${
        build.error !== undefined
          ? `failed: ${build.error.split("\n")[0]}`
          : `${build.verified} verified${build.published !== undefined ? `, published v${build.published}` : ""}`
      }`,
    );
    for (const failure of build.failures) {
      lines.push(`    ${failure.ops.length} x ${failure.reason}`);
    }
  }
  if (status.auth !== undefined) {
    lines.push(
      `  auth: ${status.auth.state}${status.auth.refreshable ? ", refreshable" : ""} (${status.auth.path})`,
    );
  }
  lines.push("  next:");
  for (const step of status.next) lines.push(`    ${step}`);
  return lines;
}
