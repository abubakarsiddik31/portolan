import type { ModelPort, ModelRole, Usage } from "@abubakarsiddiik/model";
import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";
import { z } from "zod";

/** One contiguous run of acts that should become an op. */
export type TraceSegment = {
  index: number;
  /** State before the first act, when the map named it. */
  from?: string;
  /** State after the last act, when the map named it. */
  to?: string;
  /** URL after the last act. */
  url?: string;
  /** Index of the first act entry in the trace, counting acts only. */
  start: number;
  /** Index of the last act entry, inclusive. */
  end: number;
  actions: TraceAct[];
  /** The op whose from/to exactly matches, when one does. */
  candidate?: string;
  /** Why this boundary was chosen. */
  reason: string;
};

export type SegmentLabel = {
  index: number;
  action: "reuse" | "extend" | "propose";
  op?: string;
  name?: string;
  summary?: string;
  reason: string;
};

export const segmentLabelsSchema = z.object({
  segments: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      action: z.enum(["reuse", "extend", "propose"]),
      op: z.string().optional(),
      name: z.string().optional(),
      summary: z.string().optional(),
      reason: z.string(),
    }),
  ),
});

export type SegmentLabels = z.infer<typeof segmentLabelsSchema>;

const labelsJsonSchema = z.toJSONSchema(segmentLabelsSchema) as Record<string, unknown>;

const SEGMENT_SYSTEM = `You are Portolan's trace segmenter.
You are given the ops that already exist for a site and a run cut at state and URL changes.
For each segment, decide whether an existing op fits (reuse), an existing op is close but needs a change (extend), or the segment is a new op (propose).
Use the existing op name for reuse and extend. Give a short name and summary for propose.
Return one label per segment, in order. Return only the structured object.`;

/**
 * Cut a trace at state and URL changes, then merge pieces that belong to one
 * op according to the map's from/to sets.
 *
 * The deterministic cut is deliberately conservative: it does not guess an op
 * it cannot match. The model labels what is left.
 */
export function segmentTrace(trace: Trace, map: SiteMap): TraceSegment[] {
  const acts = trace.entries.filter((entry): entry is TraceAct => entry.kind === "act");
  if (acts.length === 0) return [];

  const raw: Array<{ start: number; end: number; reason: string }> = [];
  let start = 0;

  for (let index = 0; index < acts.length; index += 1) {
    const act = acts[index];
    if (act === undefined) continue;

    const previous = index > 0 ? acts[index - 1] : undefined;
    const next = acts[index + 1];
    const stateChanged = act.before_state !== act.after_state;
    const urlChanged = previous !== undefined && act.url !== previous.url;
    const gap = next !== undefined && next.before_state !== act.after_state;

    if (index === acts.length - 1 || stateChanged || urlChanged || gap) {
      raw.push({
        start,
        end: index,
        reason: stateChanged
          ? "state changed"
          : urlChanged
            ? "url changed"
            : gap
              ? "state gap"
              : "last act",
      });
      start = index + 1;
    }
  }

  return merge(raw, acts, map);
}

/**
 * Ask the model to name each segment against the existing map.
 *
 * The deterministic candidate is included as a hint, not an answer: the model
 * can reuse it, extend a nearby op, or propose something new.
 */
export async function labelSegments(options: {
  model: ModelPort;
  map: SiteMap;
  segments: TraceSegment[];
  role?: ModelRole;
}): Promise<{ labels: SegmentLabel[]; usage: Usage }> {
  if (options.segments.length === 0) {
    return {
      labels: [],
      usage: { input: 0, cached_input: 0, output: 0, provider: "unknown", model: "unknown" },
    };
  }

  const prompt = buildLabelPrompt(options.map, options.segments);
  const decided = await options.model.object<SegmentLabels>({
    role: options.role ?? "segment",
    system: SEGMENT_SYSTEM,
    prompt,
    schema: labelsJsonSchema,
    maxTokens: 1_200,
  });

  const byIndex = new Map(decided.value.segments.map((label) => [label.index, label]));
  const labels: SegmentLabel[] = [];

  for (const segment of options.segments) {
    const label = byIndex.get(segment.index);
    if (label === undefined) throw new Error(`the model did not label segment ${segment.index}`);
    labels.push(label);
  }

  return { labels, usage: decided.usage };
}

function merge(
  raw: Array<{ start: number; end: number; reason: string }>,
  acts: TraceAct[],
  map: SiteMap,
): TraceSegment[] {
  const segments: TraceSegment[] = [];
  let index = 0;

  while (index < raw.length) {
    const piece = raw[index];
    if (piece === undefined) break;

    const from = acts[piece.start]?.before_state;
    const to = acts[piece.end]?.after_state;
    const exact = matchingOps(map.ops, from, to, acts.slice(piece.start, piece.end + 1));

    if (exact.length === 1) {
      segments.push(makeSegment(segments.length, piece, acts, exact[0]?.name, piece.reason));
      index += 1;
      continue;
    }

    const forward = exact.length === 0 ? forwardOp(map.ops, from, acts, raw, index) : undefined;
    if (forward !== undefined) {
      segments.push(
        makeSegment(
          segments.length,
          { start: piece.start, end: forward.end, reason: `merged into ${forward.op.name}` },
          acts,
          forward.op.name,
          `reached the op's to state after ${forward.end - piece.start + 1} pieces`,
        ),
      );
      index = forward.next;
      continue;
    }

    segments.push(
      makeSegment(
        segments.length,
        piece,
        acts,
        undefined,
        exact.length > 1 ? `ambiguous: ${exact.map((op) => op.name).join(", ")}` : piece.reason,
      ),
    );
    index += 1;
  }

  return segments;
}

function forwardOp(
  ops: OpDef[],
  from: string | undefined,
  acts: TraceAct[],
  raw: Array<{ start: number; end: number }>,
  startIndex: number,
): { op: OpDef; end: number; next: number } | undefined {
  if (from === undefined) return undefined;

  for (const op of ops) {
    if (!op.from.includes(from)) continue;

    for (let index = startIndex; index < raw.length; index += 1) {
      const piece = raw[index];
      if (piece === undefined) continue;

      const to = acts[piece.end]?.after_state;
      if (to !== undefined && op.to.includes(to)) {
        return { op, end: piece.end, next: index + 1 };
      }
    }
  }

  return undefined;
}

function matchingOps(
  ops: OpDef[],
  from: string | undefined,
  to: string | undefined,
  actions: TraceAct[],
): OpDef[] {
  if (from === undefined || to === undefined) return [];

  const exact = ops.filter((op) => op.from.includes(from) && op.to.includes(to));
  if (exact.length <= 1) return exact;

  // A typed value means the segment did form work, not a bare API call.
  const hasValue = actions.some((action) => action.do === "fill" || action.do === "select");
  const hasNavigation = actions.some(
    (action, index) =>
      action.before_state !== action.after_state ||
      action.effects.some((effect) => effect.kind === "navigation") ||
      (index > 0 && action.url !== actions[index - 1]?.url),
  );

  let candidates = exact;

  if (hasValue) {
    const ui = candidates.filter((op) => op.impls.some((impl) => impl.tier === "ui"));
    if (ui.length > 0) candidates = ui;
  }

  if (hasNavigation) {
    const navigable = candidates.filter((op) =>
      op.impls.some((impl) => impl.tier === "url" || impl.tier === "ui"),
    );
    if (navigable.length > 0) candidates = navigable;
  }

  return candidates;
}

function makeSegment(
  index: number,
  piece: { start: number; end: number; reason: string },
  acts: TraceAct[],
  candidate: string | undefined,
  reason: string,
): TraceSegment {
  const first = acts[piece.start];
  const last = acts[piece.end];

  return {
    index,
    ...(first?.before_state !== undefined ? { from: first.before_state } : {}),
    ...(last?.after_state !== undefined ? { to: last.after_state } : {}),
    ...(last?.url !== undefined ? { url: last.url } : {}),
    start: piece.start,
    end: piece.end,
    actions: acts.slice(piece.start, piece.end + 1),
    ...(candidate !== undefined ? { candidate } : {}),
    reason,
  };
}

function buildLabelPrompt(map: SiteMap, segments: TraceSegment[]): string {
  const ops = map.ops
    .map(
      (op) => `- ${op.name}: ${op.summary} | from: ${op.from.join(", ")} | to: ${op.to.join(", ")}`,
    )
    .join("\n");

  const rendered = segments
    .map((segment) => {
      const actions = segment.actions
        .map((action) => {
          const target = action.locator?.name ?? action.ref;
          const value = action.value === undefined ? "" : ` = ${JSON.stringify(action.value)}`;
          return `  ${action.do} ${target}${value}`;
        })
        .join("\n");

      return `${segment.index}. ${segment.from ?? "?"} -> ${segment.to ?? "?"} | ${
        segment.url ?? "?"
      }\n${actions}${segment.candidate !== undefined ? `\n  candidate: ${segment.candidate}` : ""}`;
    })
    .join("\n\n");

  return `EXISTING OPS:
${ops}

SEGMENTS:
${rendered}

Label every segment.`;
}
