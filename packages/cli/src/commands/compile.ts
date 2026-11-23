import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  type CompiledCandidate,
  type CompileOptions,
  compileCandidates,
  labelTraces,
  type PublishResult,
  publishMap,
  type SegmentLabel,
  segmentTrace,
  type VerifyReport,
  verifyOp,
} from "@abubakarsiddiik/compiler";
import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import {
  BrowserHandle,
  findChrome,
  PlaywrightEngine,
  Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";

import { paramSetsFor } from "./param-sets.js";

export type CompileOptionsInput = {
  mapPath: string;
  tracePaths: string[];
  /** Used to capture a url op's post-state. */
  baseUrl?: string;
  /** JSON object: op name to the read op that proves the write. */
  outcomeChecksPath?: string;
  /** JSON object: op name to at least three param sets to verify it with. */
  paramsPath?: string;
  /** Run recorded writes during verification. Off by default: they change data. */
  verifyWrites?: boolean;
  /** Chrome binary; defaults to CHROME_PATH or auto-detection. */
  chrome?: string;
  /** Default true. */
  headless?: boolean;
  /** Playwright storage state for pages behind auth. */
  storageState?: string;
};

export type CompileDeps = {
  compileCandidates?: (options: CompileOptions) => Promise<CompiledCandidate[]>;
  publishMap?: (options: Parameters<typeof publishMap>[0]) => Promise<PublishResult>;
  verifyOp?: typeof verifyOp;
  capture?: (url: string) => Promise<SubstrateView | undefined>;
  close?: () => Promise<void>;
};

export type CompileResult = {
  map: SiteMap;
  published: PublishResult;
  candidates: CompiledCandidate[];
  reports: VerifyReport[];
};

/**
 * Compile traces into candidate ops, verify them, and publish a new map version.
 *
 * The traces are the evidence; the map supplies the op names and schemas, and
 * a segment the map does not cover is named from its recorded actions. A url
 * op's post-state is captured from a live browser when `--base-url` is given.
 * Only a candidate that passes verification is published: a write that was not
 * verified with `--verify-writes` and explicit params stays out of the map.
 */
export async function runCompile(
  input: CompileOptionsInput,
  deps: CompileDeps = {},
): Promise<CompileResult> {
  if (input.tracePaths.length === 0) {
    throw new Error("compile needs at least one trace file");
  }

  const map = parseMap(readFileSync(input.mapPath, "utf8"));
  const recorded = input.tracePaths.map((path) => readTrace(path));
  const derived = labelTraces(recorded, map);
  const traces = recorded.map((trace, index) => ({
    trace,
    labels: labelsFor(trace, derived[index] ?? [], map),
  }));
  const outcomeChecks = readJson<Record<string, string>>(input.outcomeChecksPath);
  const params = readJson<Record<string, Array<Record<string, unknown>>>>(input.paramsPath) ?? {};

  const live =
    deps.capture === undefined && input.baseUrl !== undefined
      ? await liveCapture(input.baseUrl, input.chrome, input.headless ?? true, input.storageState)
      : undefined;
  const capture = deps.capture ?? live?.capture ?? (async () => undefined);

  const compile = deps.compileCandidates ?? compileCandidates;
  const publish = deps.publishMap ?? publishMap;
  const verify = deps.verifyOp ?? verifyOp;
  let browser: BrowserHandle | undefined;

  try {
    const candidates = await compile({
      map,
      traces,
      capture,
      skipWritesWithoutOutcomeCheck: true,
      ...(outcomeChecks !== undefined ? { outcomeChecks } : {}),
    });

    if (candidates.length === 0) {
      throw new Error("the traces produced no candidate ops");
    }

    // A segment whose states the map does not name matches whatever page the
    // session is on, as bootstrap does.
    const states = [...map.states];
    for (const { op } of candidates) {
      op.from = op.from.map((id) => (id === "unknown" ? "root" : id));
      op.to = op.to.map((id) => (id === "unknown" ? "root" : id));
      if ([...op.from, ...op.to].includes("root") && !states.some((state) => state.id === "root")) {
        states.push({ id: "root", marks: [] });
      }
    }

    const names = new Set(candidates.map((candidate) => candidate.op.name));
    const candidateMap: SiteMap = {
      ...map,
      states,
      ops: [...map.ops.filter((op) => !names.has(op.name)), ...candidates.map((c) => c.op)],
    };
    const baseUrl = input.baseUrl ?? map.origins[0];
    const executablePath = input.chrome ?? findChrome();
    const reports: VerifyReport[] = [];

    for (const candidate of candidates) {
      const op = candidate.op;
      const reason = (message: string): VerifyReport => ({
        op: op.name,
        verified: false,
        impls: [],
        reason: message,
      });

      if (op.effect !== "read" && input.verifyWrites !== true) {
        reports.push(
          reason(`${op.name} is a ${op.effect}; verify it explicitly with --verify-writes`),
        );
        continue;
      }

      // The recorded run is the first param set; verification needs three.
      const recordedParams = candidate.segment?.params ?? [];
      const observed =
        recordedParams.length > 0
          ? [Object.fromEntries(recordedParams.map((param) => [param.name, param.value]))]
          : undefined;
      const sets = paramSetsFor(op, observed, params[op.name]);
      if (sets === undefined) {
        reports.push(reason(`add at least three parameter sets for ${op.name} with --params`));
        continue;
      }

      if (deps.verifyOp === undefined && browser === undefined && executablePath !== undefined) {
        browser = await BrowserHandle.launch({
          executablePath,
          headless: input.headless ?? true,
        });
      }

      try {
        reports.push(
          await verify({
            map: candidateMap,
            op,
            paramSets: sets,
            ...(baseUrl !== undefined ? { baseUrl } : {}),
            ...(executablePath !== undefined ? { executablePath } : {}),
            ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
            ...(browser !== undefined ? { browser } : {}),
            headless: input.headless ?? true,
          }),
        );
      } catch (error) {
        reports.push(
          reason(`verification crashed: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }

    const passed = new Set(reports.filter((report) => report.verified).map((report) => report.op));
    if (passed.size === 0) {
      throw new Error(
        `nothing verified:\n${reports.map((r) => `  ${r.op}: ${r.reason ?? "every impl failed"}`).join("\n")}`,
      );
    }

    const published = await publish({
      dir: dirname(input.mapPath),
      map: { ...map, states },
      candidates: candidates.map((candidate) => ({
        op: candidate.op,
        verified: passed.has(candidate.op.name),
        ...(candidate.source !== undefined ? { source: candidate.source } : {}),
      })),
    });

    return { map, published, candidates, reports };
  } finally {
    await deps.close?.();
    await browser?.close();
    await live?.close();
  }
}

/**
 * Labels for the segments no existing op covers, so a new action gets a name
 * taken from what was recorded. A segment that matches an op keeps that op's
 * name through the compiler.
 */
function labelsFor(trace: Trace, derived: SegmentLabel[], map: SiteMap): SegmentLabel[] {
  const covered = new Set(
    segmentTrace(trace, map)
      .filter((segment) => segment.candidate !== undefined)
      .map((segment) => segment.index),
  );
  return derived.filter((label) => !covered.has(label.index));
}

function readJson<T>(path: string | undefined): T | undefined {
  return path === undefined ? undefined : (JSON.parse(readFileSync(path, "utf8")) as T);
}

async function liveCapture(
  baseUrl: string,
  chrome: string | undefined,
  headless: boolean,
  storageState: string | undefined,
): Promise<{
  capture: (url: string) => Promise<SubstrateView | undefined>;
  close: () => Promise<void>;
}> {
  const executablePath = chrome ?? findChrome();
  if (executablePath === undefined) {
    throw new Error("compile --base-url needs Chrome; install it or set CHROME_PATH");
  }

  const engine = await PlaywrightEngine.launch({
    executablePath,
    headless,
    ...(storageState !== undefined ? { storageState } : {}),
  });
  const substrate = new Substrate(engine);

  return {
    capture: async (url) => {
      await engine.navigate(new URL(url, baseUrl).toString());
      return substrate.view();
    },
    close: () => engine.close(),
  };
}

function readTrace(path: string): Trace {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Trace>;

  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${path} is not a trace: it has no entries array`);
  }

  return parsed as Trace;
}
