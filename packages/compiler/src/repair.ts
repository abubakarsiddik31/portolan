import { randomUUID } from "node:crypto";

import type { ModelPort, ModelRole, Usage } from "@portolan/model";
import type { SiteMap } from "@portolan/protocol";
import {
  recognizeState,
  type Trace,
  type TraceAct,
  type TraceEntry,
  type TraceLocator,
  type TraceRead,
  type TraceView,
} from "@portolan/runtime";
import {
  rankAffordances,
  renderAffordances,
  type Substrate,
  type SubstrateView,
} from "@portolan/substrate";
import { z } from "zod";

/** The four substrate verbs the repair agent may use. */
export type RepairSubstrate = Pick<Substrate, "view" | "state" | "act" | "read">;

export const repairDecisionSchema = z.object({
  thought: z.string(),
  tool: z.enum(["act", "view", "read", "done"]),
  ref: z.string().optional(),
  do: z.enum(["click", "check", "uncheck", "fill", "select", "press"]).optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  answer: z.string().optional(),
});

export type RepairDecision = z.infer<typeof repairDecisionSchema>;

const decisionJsonSchema = z.toJSONSchema(repairDecisionSchema) as Record<string, unknown>;

const REPAIR_SYSTEM = `You are Portolan's headless repair agent.
Complete one intent on the current page using only the affordances shown.
Call act with a ref from the list, view to re-read after a navigation, or read to inspect text.
Never invent a ref. When the intent is complete, call done with a short answer.
Return only the structured object.`;

export type RepairStep = {
  step: number;
  decision: RepairDecision;
  result: string;
  usage: Usage;
  ms: number;
};

export type RepairOptions = {
  model: ModelPort;
  substrate: RepairSubstrate;
  goal: string;
  /** Optional map, used to name the state before and after each action. */
  map?: SiteMap;
  role?: ModelRole;
  maxSteps?: number;
  effect?: "read" | "write" | "irreversible";
  scopeId?: string;
  sid?: string;
  /** Stronger than the model's claim: check the live page before accepting done. */
  check?: (view: SubstrateView) => Promise<boolean> | boolean;
  onStep?: (step: RepairStep) => void;
};

export type RepairResult = {
  ok: boolean;
  answer?: string;
  reason?: string;
  steps: RepairStep[];
  trace: Trace;
  usage: Usage;
};

const DEFAULT_MAX_STEPS = 15;

/**
 * Complete an intent without a map op, headlessly.
 *
 * This is the caller's fallback loop with the model inside it instead of the
 * caller. It returns a trace in the same shape as a fallback scope, so the
 * compiler can treat a repair run exactly like a recorded run.
 */
export async function repairIntent(options: RepairOptions): Promise<RepairResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const role = options.role ?? "repair";
  const startedAt = new Date().toISOString();
  const steps: RepairStep[] = [];
  const entries: TraceEntry[] = [];
  const usages: Usage[] = [];

  let current = await options.substrate.view();
  entries.push(viewEntry(current, options.map));

  let last = "";
  let answer: string | undefined;
  let reason: string | undefined;
  let ok = false;

  for (let step = 1; step <= maxSteps; step += 1) {
    const prompt = buildPrompt({
      goal: options.goal,
      step,
      maxSteps,
      view: current,
      map: options.map,
      last,
    });

    const decided = await options.model.object<RepairDecision>({
      role,
      system: REPAIR_SYSTEM,
      prompt,
      schema: decisionJsonSchema,
      maxTokens: 600,
    });
    usages.push(decided.usage);

    const decision = decided.value;
    const stepStarted = Date.now();
    let resultText: string;

    if (decision.tool === "done") {
      answer = decision.answer ?? "";
      ok = true;
      resultText = JSON.stringify({ ok: true, done: true });
    } else if (decision.tool === "view") {
      current = await options.substrate.view();
      entries.push(viewEntry(current, options.map));
      resultText = JSON.stringify({
        ok: true,
        url: current.snapshot.url,
        affordances: affordances(current),
      });
    } else if (decision.tool === "read") {
      const read = await options.substrate.read(decision.ref);
      const entry: TraceRead = {
        kind: "read",
        at: new Date().toISOString(),
        ...(decision.ref !== undefined ? { ref: decision.ref } : {}),
        text: read.text,
      };
      entries.push(entry);
      resultText = JSON.stringify({ ok: true, text: read.text });
    } else {
      const acted = await act(options, current, decision);
      resultText = JSON.stringify(acted.result);

      if (acted.entry !== undefined) entries.push(acted.entry);
      if (acted.view !== undefined) current = acted.view;
    }

    const record: RepairStep = {
      step,
      decision,
      result: resultText,
      usage: decided.usage,
      ms: Date.now() - stepStarted,
    };
    steps.push(record);
    options.onStep?.(record);
    last = resultText;

    if (decision.tool === "done") break;
  }

  if (!ok && reason === undefined) reason = "max steps reached";

  if (ok && options.check !== undefined) {
    const passed = await options.check(current);
    if (!passed) {
      ok = false;
      reason = "success check failed";
    }
  }

  const trace: Trace = {
    scope_id: options.scopeId ?? randomUUID(),
    sid: options.sid ?? randomUUID(),
    intent: options.goal,
    effect: options.effect ?? "write",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    entries,
  };

  return {
    ok,
    ...(answer !== undefined ? { answer } : {}),
    ...(reason !== undefined ? { reason } : {}),
    steps,
    trace,
    usage: sumUsage(usages),
  };
}

async function act(
  options: RepairOptions,
  current: SubstrateView,
  decision: RepairDecision,
): Promise<{ result: unknown; entry?: TraceAct; view?: SubstrateView }> {
  if (decision.ref === undefined || decision.do === undefined) {
    return { result: { ok: false, code: "invalid_request", message: "act needs ref and do" } };
  }

  const before = options.substrate.state() ?? current;
  const locator = locatorOf(before, decision.ref);
  const beforeState = stateOf(options.map, before.snapshot);
  const value = decision.value;
  const key = decision.key;

  const result = await options.substrate.act({
    ref: decision.ref,
    do: decision.do,
    ...(value !== undefined ? { value } : {}),
    ...(key !== undefined ? { key } : {}),
  });

  if (!result.ok) return { result };

  const after = options.substrate.state();
  const afterState = after === undefined ? undefined : stateOf(options.map, after.snapshot);

  const entry: TraceAct = {
    kind: "act",
    at: new Date().toISOString(),
    ref: decision.ref,
    do: decision.do,
    ...(value !== undefined ? { value } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(locator !== undefined ? { locator } : {}),
    doc: result.doc,
    v: result.v,
    url: result.url,
    ...(beforeState !== undefined ? { before_state: beforeState } : {}),
    ...(afterState !== undefined ? { after_state: afterState } : {}),
    effects: result.effects,
    delta: result.delta,
  };

  return { result, entry, ...(after !== undefined ? { view: after } : {}) };
}

function viewEntry(view: SubstrateView, map: SiteMap | undefined): TraceView {
  const state = stateOf(map, view.snapshot);

  return {
    kind: "view",
    at: new Date().toISOString(),
    doc: view.snapshot.doc,
    v: view.snapshot.v,
    url: view.snapshot.url,
    ...(state !== undefined ? { state } : {}),
    affordances: rankAffordances(view.snapshot.nodes, { refs: view.refs }).affordances.length,
  };
}

function affordances(view: SubstrateView): Array<{ ref?: string; role: string; name: string }> {
  return rankAffordances(view.snapshot.nodes, { refs: view.refs }).affordances.map(
    (affordance) => ({
      ...(affordance.ref !== undefined ? { ref: affordance.ref } : {}),
      role: affordance.role,
      name: affordance.name,
    }),
  );
}

function locatorOf(view: SubstrateView, ref: string): TraceLocator | undefined {
  const entry = view.refs.byRef.get(ref);
  if (entry === undefined) return undefined;

  return { role: entry.role, name: entry.name, ordinal: entry.ordinal };
}

function stateOf(
  map: SiteMap | undefined,
  snapshot: SubstrateView["snapshot"],
): string | undefined {
  if (map === undefined) return undefined;
  return recognizeState(map, snapshot)?.state.id;
}

function buildPrompt(input: {
  goal: string;
  step: number;
  maxSteps: number;
  view: SubstrateView;
  map: SiteMap | undefined;
  last: string;
}): string {
  const ranked = rankAffordances(input.view.snapshot.nodes, { refs: input.view.refs });
  const rendered = renderAffordances(ranked.affordances);
  const state = stateOf(input.map, input.view.snapshot);

  return `GOAL: ${input.goal}
STEP: ${input.step}/${input.maxSteps}
PAGE: ${input.view.snapshot.url}
${state !== undefined ? `STATE: ${state}\n` : ""}
AFFORDANCES:
${rendered.text.length > 0 ? rendered.text : "(none)"}

LAST RESULT:
${input.last.length > 0 ? input.last : "(none)"}

Choose one action. Use a ref from AFFORDANCES. When the goal is complete, use done.`;
}

function sumUsage(usages: Usage[]): Usage {
  const first = usages[0];
  let input = 0;
  let cached = 0;
  let output = 0;

  for (const usage of usages) {
    input += usage.input;
    cached += usage.cached_input;
    output += usage.output;
  }

  return {
    input,
    cached_input: cached,
    output,
    provider: first?.provider ?? "unknown",
    model: first?.model ?? "unknown",
  };
}
