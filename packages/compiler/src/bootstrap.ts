import type { SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import type { SubstrateView } from "@abubakarsiddiik/substrate";

import {
  type CompiledCandidate,
  type CompileTrace,
  compileCandidates,
  isWriteEffect,
} from "./compile.js";
import { type SegmentLabel, segmentTrace, type TraceSegment } from "./segment.js";

export type BootstrapOptions = {
  site: string;
  origins: string[];
  traces: Trace[];
  /**
   * One label list per trace. When omitted, names are derived deterministically
   * from the recorded actions, so a site can be bootstrapped without a model.
   */
  labels?: SegmentLabel[][];
  capture?: (url: string) => Promise<SubstrateView | undefined>;
  outcomeChecks?: Record<string, string>;
  /** Default true: a recorded write becomes a task, not an unverifiable http op. */
  skipWritesWithoutOutcomeCheck?: boolean;
};

export type BootstrapResult = {
  /** A v1 candidate map. It is not verified and must not be served as-is. */
  map: SiteMap;
  candidates: CompiledCandidate[];
  labels: SegmentLabel[][];
};

/**
 * A map skeleton with no ops.
 *
 * `root` has no URL or marks, so it matches whatever page the session is on.
 * That is the honest state model for a mapless trace: we know the actions, not
 * the landmarks. Version 0 is a placeholder; `publishMap` derives v1 from it.
 */
export function bootstrapMap(site: string, origins: string[]): SiteMap {
  return {
    site,
    origins,
    version: 0,
    states: [{ id: "root", marks: [] }],
    ops: [],
    entities: {},
    compiled_from: [],
    verified_at: new Date(0).toISOString(),
  };
}

/**
 * Compile recorded runs into a first map without a hand-written base map.
 *
 * The compiler always needed an oracle map to name ops. Bootstrap supplies
 * names from the trace itself (an action label, then the URL), which is enough
 * for the verification step to accept or reject the candidate.
 */
export async function bootstrapFromTraces(options: BootstrapOptions): Promise<BootstrapResult> {
  const seed = bootstrapMap(options.site, options.origins);
  const labels = options.labels ?? labelTraces(options.traces, seed);
  const capture = options.capture ?? (async () => undefined);

  const traces: CompileTrace[] = options.traces.map((trace, index) => ({
    trace,
    labels: labels[index] ?? [],
    ...(trace.scope_id.length > 0 ? { source: trace.scope_id } : {}),
  }));

  const candidates = await compileCandidates({
    map: seed,
    traces,
    capture,
    ...(options.outcomeChecks !== undefined ? { outcomeChecks: options.outcomeChecks } : {}),
    skipWritesWithoutOutcomeCheck: options.skipWritesWithoutOutcomeCheck ?? true,
  });

  for (const candidate of candidates) {
    candidate.op.from = candidate.op.from.map((id) => (id === "unknown" ? "root" : id));
    candidate.op.to = candidate.op.to.map((id) => (id === "unknown" ? "root" : id));
  }

  return {
    map: {
      ...seed,
      version: 1,
      ops: candidates.map((candidate) => candidate.op),
      compiled_from: [...new Set(options.traces.map((trace) => trace.scope_id))],
      verified_at: new Date().toISOString(),
    },
    candidates,
    labels,
  };
}

/** Name every segment of every trace, keeping names unique across the site. */
export function labelTraces(traces: Trace[], map: SiteMap): SegmentLabel[][] {
  const used = new Set<string>(map.ops.map((op) => op.name));

  return traces.map((trace) =>
    segmentTrace(trace, map).map((segment) => {
      const name = uniqueName(nameFromSegment(segment), used);
      return {
        index: segment.index,
        action: "propose" as const,
        name,
        summary: summaryFromSegment(segment),
        reason: "derived from the recorded run",
      };
    }),
  );
}

export function nameFromSegment(segment: TraceSegment): string {
  // A button or link names the intent ("Search", "Add to cart"); a field name
  // alone is usually just the noun. Prefer the last click, then a field.
  // A write is named for the click that made it, not the "Done" on the
  // confirmation dialog that follows.
  const clicks = segment.actions.filter((action) => action.do === "click");
  const writer = clicks.find((action) => action.effects.some(isWriteEffect));
  if (writer?.locator !== undefined && opName(writer.locator.name) !== "op") {
    return opName(writer.locator.name);
  }

  for (const action of clicks.reverse()) {
    const label = action.locator?.name;
    if (label !== undefined && opName(label) !== "op") return opName(label);
  }

  for (const action of segment.actions) {
    if (action.do !== "fill" && action.do !== "select") continue;
    const label = action.locator?.name;
    if (label !== undefined) return opName(label);
  }

  for (const action of segment.actions) {
    const label = action.locator?.name;
    if (label !== undefined) return opName(label);
  }

  return opName(pathLabel(segment.url)) || "op";
}

function summaryFromSegment(segment: TraceSegment): string {
  const steps: string[] = [];

  for (const action of segment.actions) {
    const target = action.locator?.name;
    if (action.do === "fill" || action.do === "select") {
      steps.push(target === undefined ? action.do : `${action.do} ${target}`);
    } else if (action.do === "click") {
      steps.push(target === undefined ? "click" : `click ${target}`);
    } else {
      steps.push(action.do);
    }
  }

  if (steps.length === 0) {
    return segment.url === undefined ? "Recorded operation." : `Open ${pathLabel(segment.url)}.`;
  }

  const summary = `Recorded: ${steps.join(", ")}.`;
  return summary.length <= 200 ? summary : `${summary.slice(0, 197)}...`;
}

function pathLabel(url: string | undefined): string {
  if (url === undefined) return "op";

  try {
    const parsed = new URL(url, "http://portolan.local");
    const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
    const last = parts.at(-1);
    if (last === undefined) return "home";
    return decodeURIComponent(last);
  } catch {
    return "op";
  }
}

function opName(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length === 0) return "op";
  return /^[a-z]/.test(normalized) ? normalized : `op_${normalized}`;
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name.slice(0, 64);
  let suffix = 2;

  while (used.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${name.slice(0, 64 - tail.length)}${tail}`;
    suffix += 1;
  }

  used.add(candidate);
  return candidate;
}
