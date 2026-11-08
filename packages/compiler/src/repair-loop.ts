import type { OpDef, PostCheck, SiteMap } from "@portolan/protocol";
import type { Trace } from "@portolan/runtime";
import type { SubstrateView } from "@portolan/substrate";

import { type CompiledCandidate, compileCandidates } from "./compile.js";
import { type PublishResult, publishMap } from "./publish.js";
import { segmentTrace } from "./segment.js";
import { type VerifyReport, verifyOp } from "./verify.js";

export type RepairRun = (input: {
  map: SiteMap;
  op: OpDef;
  intent: string;
  params: Record<string, unknown>;
}) => Promise<Trace>;

export type RepairOpOptions = {
  map: SiteMap;
  op: OpDef;
  intent: string;
  params: Record<string, unknown>;
  paramSets: Array<Record<string, unknown>>;
  repair: RepairRun;
  capture: (url: string) => Promise<SubstrateView | undefined>;
  /** The site map directory to publish into. */
  dir: string;
  baseUrl?: string;
  executablePath?: string;
  outcomeChecks?: Record<string, string>;
  /** Override the op's post checks when the state moved with the route. */
  post?: PostCheck[];
  setup?: Array<{ op: string; params: Record<string, unknown> }>;
  now?: string;
};

export type RepairOpResult = {
  op: string;
  repaired: boolean;
  reason?: string;
  candidate?: CompiledCandidate;
  verification?: VerifyReport;
  published?: PublishResult;
};

/**
 * Repair one degraded op end to end.
 *
 * The caller supplies a repair run that finishes the op's intent with the
 * substrate and returns its trace. This function segments the trace, labels
 * the last segment as the broken op, compiles it, verifies it on fresh
 * sessions, and publishes the new map version. No map edit happens by hand.
 */
export async function repairOp(options: RepairOpOptions): Promise<RepairOpResult> {
  const trace = await options.repair({
    map: options.map,
    op: options.op,
    intent: options.intent,
    params: options.params,
  });

  const segments = segmentTrace(trace, options.map);
  if (segments.length === 0) {
    return { op: options.op.name, repaired: false, reason: "the repair trace has no actions" };
  }

  const last = segments.length - 1;
  const labels = segments.flatMap((segment, index) => {
    if (index === last) {
      return [
        {
          index: segment.index,
          action: "reuse" as const,
          op: options.op.name,
          reason: "repair target",
        },
      ];
    }

    return segment.candidate === undefined
      ? []
      : [
          {
            index: segment.index,
            action: "reuse" as const,
            op: segment.candidate,
            reason: "setup",
          },
        ];
  });

  const source = `trace:repair:${options.op.name}`;
  const candidates = await compileCandidates({
    map: options.map,
    traces: [{ trace, labels, source }],
    capture: options.capture,
    ...(options.outcomeChecks !== undefined ? { outcomeChecks: options.outcomeChecks } : {}),
  });

  const candidate = candidates.find((entry) => entry.op.name === options.op.name);
  if (candidate === undefined) {
    return {
      op: options.op.name,
      repaired: false,
      reason: "the compiler did not produce a candidate for this op",
    };
  }

  if (options.post !== undefined) {
    candidate.op = { ...candidate.op, post: options.post };
  }

  const verification = await verifyOp({
    map: options.map,
    op: candidate.op,
    paramSets: options.paramSets,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.executablePath !== undefined ? { executablePath: options.executablePath } : {}),
    ...(options.setup !== undefined ? { setup: options.setup } : {}),
  });

  if (!verification.verified) {
    return {
      op: options.op.name,
      repaired: false,
      reason: verification.reason ?? "the repaired op did not verify",
      candidate,
      verification,
    };
  }

  const published = await publishMap({
    dir: options.dir,
    map: options.map,
    candidates: [{ op: candidate.op, verified: true, source }],
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  return {
    op: options.op.name,
    repaired: true,
    candidate,
    verification,
    published,
  };
}
