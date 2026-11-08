import type { Extractor, Impl, OpDef, SiteMap } from "@portolan/protocol";
import type { Trace } from "@portolan/runtime";
import type { Effect, NetworkEffect, SubstrateView } from "@portolan/substrate";

import { liftHttp } from "./http.js";
import { liftUrl } from "./lift.js";
import { type ParameterizedSegment, parameterizeTrace } from "./parameterize.js";
import { type InferredReturns, inferJsonReturns, inferReturns } from "./returns.js";
import type { SegmentLabel } from "./segment.js";
import { liftUi } from "./ui.js";

export type CompileTrace = {
  trace: Trace;
  labels?: SegmentLabel[];
  source?: string;
};

export type CompileOptions = {
  map: SiteMap;
  traces: CompileTrace[];
  /** Capture the post-state of a url segment. Return undefined if it is gone. */
  capture: (url: string) => Promise<SubstrateView | undefined>;
  /** Read op that proves a write, keyed by op name. */
  outcomeChecks?: Record<string, string>;
};

export type CompiledCandidate = {
  op: OpDef;
  segment: ParameterizedSegment;
  tier: "url" | "http" | "ui";
  source?: string;
};

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

/**
 * Compile traces into candidate ops.
 *
 * A segment with a successful non-GET request lifts to `http`; otherwise a
 * segment with a URL lifts to `url`. The candidate keeps the oracle op's
 * params, from/to, and effect when the map already names it, and takes its
 * returns from the response body or the captured post-state.
 */
export async function compileCandidates(options: CompileOptions): Promise<CompiledCandidate[]> {
  const candidates: CompiledCandidate[] = [];
  const seen = new Set<string>();

  for (const input of options.traces) {
    const labels = new Map((input.labels ?? []).map((label) => [label.index, label]));
    const parameterized = parameterizeTrace(
      { trace: input.trace, ...(input.labels !== undefined ? { labels: input.labels } : {}) },
      options.map,
    );

    for (const segment of parameterized.segments) {
      const label = labels.get(segment.segment.index);
      const name = label?.op ?? segment.segment.candidate;
      if (name === undefined || seen.has(name)) continue;

      const write = segment.segment.actions.flatMap((action) => action.effects).find(isWriteEffect);

      let tier: "url" | "http" | "ui";
      let returns: InferredReturns;
      let impl: Impl;

      if (write !== undefined) {
        tier = "http";
        returns = inferJsonReturns(write.response_body);

        const lift = liftHttp({
          segment,
          returns,
          ...(options.outcomeChecks?.[name] !== undefined
            ? { outcomeCheck: options.outcomeChecks[name] }
            : {}),
        });
        if (lift === undefined) continue;

        impl = { tier: "http", steps: lift.steps, extract: lift.extract };
      } else {
        returns =
          segment.segment.url === undefined
            ? noneReturns()
            : await captureReturns(options.capture, segment.segment.url);

        const urlLift =
          segment.segment.url === undefined ? undefined : liftUrl({ segment, returns });

        if (urlLift !== undefined) {
          tier = "url";
          impl = { tier: "url", route: urlLift.route, extract: urlLift.extract };
        } else {
          const uiLift = liftUi({ segment, returns });
          if (uiLift === undefined) continue;

          tier = "ui";
          impl = { tier: "ui", steps: uiLift.steps, extract: uiLift.extract };
        }
      }

      const oracle = options.map.ops.find((op) => op.name === name);

      const op: OpDef = {
        name,
        version: oracle?.version ?? 1,
        summary: oracle?.summary ?? `Compiled ${name}.`,
        params: oracle?.params ?? (isEmptySchema(segment.schema) ? EMPTY_SCHEMA : segment.schema),
        returns: returns.schema,
        from: oracle?.from ?? [segment.segment.from ?? "unknown"],
        to: oracle?.to ?? [segment.segment.to ?? "unknown"],
        post: tier === "http" ? [] : (oracle?.post ?? []),
        effect: oracle?.effect ?? (tier === "http" ? "write" : "read"),
        status: "verified",
        ...(options.outcomeChecks?.[name] !== undefined
          ? { outcome_check: options.outcomeChecks[name] }
          : oracle?.outcome_check !== undefined
            ? { outcome_check: oracle.outcome_check }
            : {}),
        impls: [impl],
      };

      candidates.push({
        op,
        segment,
        tier,
        ...(input.source !== undefined ? { source: input.source } : {}),
      });
      seen.add(name);
    }
  }

  return candidates;
}

async function captureReturns(
  capture: CompileOptions["capture"],
  url: string,
): Promise<InferredReturns> {
  const view = await capture(url);
  return view === undefined ? noneReturns() : inferReturns(view);
}

function noneReturns(): InferredReturns {
  return {
    kind: "none",
    extractor: { kind: "none" },
    value: {},
    schema: EMPTY_SCHEMA,
  };
}

function isWriteEffect(
  effect: Effect,
): effect is NetworkEffect & { method: string; status: number } {
  return (
    effect.kind === "network" &&
    effect.method !== undefined &&
    effect.method !== "GET" &&
    effect.method !== "HEAD" &&
    effect.status !== undefined &&
    effect.status >= 200 &&
    effect.status < 300 &&
    effect.request_body !== undefined
  );
}

function isEmptySchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return true;
  const properties = (schema as { properties?: unknown }).properties;
  return (
    typeof properties !== "object" || properties === null || Object.keys(properties).length === 0
  );
}

// Keeps the extractor type visible to callers that narrow on tier.
export type { Extractor };
