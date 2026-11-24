import type { Extractor, Impl, OpDef, PostCheck, SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import type { Effect, NetworkEffect, SubstrateView } from "@abubakarsiddiik/substrate";

import { runContext, summaryFor } from "./context.js";
import { liftHttp } from "./http.js";
import { liftUrl } from "./lift.js";
import { type ParameterizedSegment, parameterizeTrace } from "./parameterize.js";
import { inferPost } from "./post.js";
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
  /**
   * Compile a write that has no outcome check to a `ui` op instead of an http
   * impl the map loader would reject. Bootstrap uses this: a recording proves
   * the request happened, not how to check that a later write took effect, so
   * the op stays a candidate until a verified run promotes it.
   */
  skipWritesWithoutOutcomeCheck?: boolean;
  /** Propose postconditions from what the recorded run observed. Default true. */
  inferPost?: boolean;
};

export type CompiledCandidate = {
  op: OpDef;
  /** The postconditions proposed from the recording, so a reviewer can see them. */
  inferredPost?: PostCheck[];
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
      const proposed = label?.action === "propose" ? label.name : undefined;
      const name = label?.op ?? proposed ?? segment.segment.candidate;
      if (name === undefined || seen.has(name)) continue;

      const write = segment.segment.actions.flatMap((action) => action.effects).find(isWriteEffect);

      const uiWrite =
        write !== undefined &&
        options.skipWritesWithoutOutcomeCheck === true &&
        options.outcomeChecks?.[name] === undefined;

      let tier: "url" | "http" | "ui";
      let returns: InferredReturns;
      let impl: Impl;

      if (write !== undefined && !uiWrite) {
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

        impl = {
          tier: "http",
          steps: lift.steps,
          extract: lift.extract,
          ...(lift.auth !== undefined ? { auth: lift.auth } : {}),
        };
      } else {
        // The url tier is read-only, so a write goes straight to ui steps.
        returns =
          segment.segment.url === undefined || uiWrite
            ? noneReturns()
            : await captureReturns(options.capture, segment.segment.url);

        const urlLift =
          segment.segment.url === undefined || uiWrite ? undefined : liftUrl({ segment, returns });

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
      const inferred =
        tier === "ui" && oracle === undefined && options.inferPost !== false
          ? inferPost(segment.segment.actions, options.map)
          : [];

      const context =
        oracle?.context ?? runContext({ trace: input.trace, actions: segment.segment.actions });

      const op: OpDef = {
        name,
        version: oracle?.version ?? 1,
        summary: summaryFor(label?.summary ?? oracle?.summary ?? `Compiled ${name}.`, context),
        ...(Object.keys(context).length > 0 ? { context } : {}),
        params: oracle?.params ?? (isEmptySchema(segment.schema) ? EMPTY_SCHEMA : segment.schema),
        returns: returns.schema,
        from: oracle?.from ?? [segment.segment.from ?? "unknown"],
        to: oracle?.to ?? [segment.segment.to ?? "unknown"],
        post: tier === "http" ? [] : (oracle?.post ?? inferred),
        effect: oracle?.effect ?? (tier === "http" || uiWrite ? "write" : "read"),
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
        ...(inferred.length > 0 ? { inferredPost: inferred } : {}),
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

export function isWriteEffect(
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
