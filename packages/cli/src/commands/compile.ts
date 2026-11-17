import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  type CompiledCandidate,
  type CompileOptions,
  compileCandidates,
  type PublishResult,
  publishMap,
} from "@abubakarsiddiik/compiler";
import { parseMap, type SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import {
  findChrome,
  PlaywrightEngine,
  Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";

export type CompileOptionsInput = {
  mapPath: string;
  tracePaths: string[];
  /** Used to capture a url op's post-state. */
  baseUrl?: string;
  /** JSON object: op name to the read op that proves the write. */
  outcomeChecksPath?: string;
  /** Chrome binary; defaults to CHROME_PATH or auto-detection. */
  chrome?: string;
  /** Default true. */
  headless?: boolean;
};

export type CompileDeps = {
  compileCandidates?: (options: CompileOptions) => Promise<CompiledCandidate[]>;
  publishMap?: (options: Parameters<typeof publishMap>[0]) => Promise<PublishResult>;
  capture?: (url: string) => Promise<SubstrateView | undefined>;
  close?: () => Promise<void>;
};

export type CompileResult = {
  map: SiteMap;
  published: PublishResult;
  candidates: CompiledCandidate[];
};

/**
 * Compile traces into candidate ops and publish a new map version.
 *
 * The traces are the evidence; the map supplies the op names and schemas. A
 * url op's post-state is captured from a live browser when `--base-url` is
 * given; without one, the url tier falls back to what the trace already has.
 */
export async function runCompile(
  input: CompileOptionsInput,
  deps: CompileDeps = {},
): Promise<CompileResult> {
  if (input.tracePaths.length === 0) {
    throw new Error("compile needs at least one trace file");
  }

  const map = parseMap(readFileSync(input.mapPath, "utf8"));
  const traces = input.tracePaths.map((path) => ({ trace: readTrace(path) }));
  const outcomeChecks =
    input.outcomeChecksPath === undefined
      ? undefined
      : (JSON.parse(readFileSync(input.outcomeChecksPath, "utf8")) as Record<string, string>);

  const live =
    deps.capture === undefined && input.baseUrl !== undefined
      ? await liveCapture(input.baseUrl, input.chrome, input.headless ?? true)
      : undefined;
  const capture = deps.capture ?? live?.capture ?? (async () => undefined);

  const compile = deps.compileCandidates ?? compileCandidates;
  const publish = deps.publishMap ?? publishMap;

  try {
    const candidates = await compile({
      map,
      traces,
      capture,
      ...(outcomeChecks !== undefined ? { outcomeChecks } : {}),
    });

    if (candidates.length === 0) {
      throw new Error("the traces produced no candidate ops");
    }

    const published = await publish({
      dir: dirname(input.mapPath),
      map,
      candidates: candidates.map((candidate) => ({
        op: candidate.op,
        verified: true,
        ...(candidate.source !== undefined ? { source: candidate.source } : {}),
      })),
    });

    return { map, published, candidates };
  } finally {
    await deps.close?.();
    await live?.close();
  }
}

async function liveCapture(
  baseUrl: string,
  chrome: string | undefined,
  headless: boolean,
): Promise<{
  capture: (url: string) => Promise<SubstrateView | undefined>;
  close: () => Promise<void>;
}> {
  const executablePath = chrome ?? findChrome();
  if (executablePath === undefined) {
    throw new Error("compile --base-url needs Chrome; install it or set CHROME_PATH");
  }

  const engine = await PlaywrightEngine.launch({ executablePath, headless });
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
