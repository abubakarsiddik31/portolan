import type { Locator, OpDef, SiteMap, UiImpl } from "@portolan/protocol";
import type { ActResult, Effect, Substrate, SubstrateView } from "@portolan/substrate";

import { checkPost, extract, validateReturns } from "./extract.js";
import { matchingNodes, recognizeState } from "./state.js";
import { fillTemplate } from "./template.js";

export type UiRunInput = {
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
  substrate: Substrate;
};

export type UiRunResult =
  | { ok: true; result: unknown; state: string; effects: Effect[] }
  | {
      ok: false;
      code: "precondition_failed";
      message: string;
      current_state?: string;
    }
  | { ok: false; code: "op_broken"; message: string; details?: Record<string, unknown> }
  | {
      ok: false;
      code: "invalid_params";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Run a `ui` op: resolve each step's locator to a ref, act through the
 * substrate, wait for the declared states, check the postconditions, extract
 * the return value, and validate it against the op's schema.
 */
export async function runUiOp(input: UiRunInput): Promise<UiRunResult> {
  const { map, op, params, substrate } = input;

  const impl = op.impls.find((candidate): candidate is UiImpl => candidate.tier === "ui");
  if (impl === undefined) {
    return { ok: false, code: "op_broken", message: `op "${op.name}" has no ui impl` };
  }

  let view = await substrate.view();
  const initial = recognizeState(map, view.snapshot);

  if (initial === undefined || !op.from.includes(initial.state.id)) {
    return {
      ok: false,
      code: "precondition_failed",
      message: `op "${op.name}" needs ${op.from.join(" or ")}, found ${
        initial?.state.id ?? "unknown"
      }`,
      ...(initial !== undefined ? { current_state: initial.state.id } : {}),
    };
  }

  const effects: Effect[] = [];

  for (const [index, step] of impl.steps.entries()) {
    if (step.do === "await_state") {
      view = await substrate.view();
      const match = recognizeState(map, view.snapshot);

      if (match?.state.id !== step.state) {
        return {
          ok: false,
          code: "op_broken",
          message: `step ${index}: expected state "${step.state}", found "${
            match?.state.id ?? "unknown"
          }"`,
        };
      }

      continue;
    }

    if (step.do === "press") {
      return {
        ok: false,
        code: "op_broken",
        message: "press is not supported by the ui executor yet",
      };
    }

    const ref = resolveRef(view, step.target);
    if (ref === undefined) {
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: locator did not resolve`,
        details: { locator: step.target },
      };
    }

    if (step.do === "fill" || step.do === "select") {
      const value = fillTemplate(step.value, params);
      if (value === undefined) {
        return {
          ok: false,
          code: "invalid_params",
          message: `step ${index}: missing param in "${step.value}"`,
        };
      }

      const result = await substrate.act({ ref, do: step.do, value }, { settle: false });
      if (!result.ok) return fromAct(result, index);

      effects.push(...result.effects);
      view = substrate.state() ?? (await substrate.view());
      continue;
    }

    const result = await substrate.act({ ref, do: step.do }, { settle: false });
    if (!result.ok) return fromAct(result, index);

    effects.push(...result.effects);
    view = substrate.state() ?? (await substrate.view());
  }

  view = await substrate.view();

  for (const check of op.post) {
    const failure = checkPost(check, map, view);
    if (failure !== undefined) {
      return { ok: false, code: "op_broken", message: failure };
    }
  }

  const extracted = extract(impl.extract, view);
  if (!extracted.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: extracted.message,
      ...(extracted.details !== undefined ? { details: extracted.details } : {}),
    };
  }

  const validated = validateReturns(op, extracted.value);
  if (!validated.ok) {
    return {
      ok: false,
      code: "op_broken",
      message: validated.message,
      ...(validated.details !== undefined ? { details: validated.details } : {}),
    };
  }

  const finalState = recognizeState(map, view.snapshot);

  return {
    ok: true,
    result: validated.value,
    state: finalState?.state.id ?? "unknown",
    effects,
  };
}

function resolveRef(view: SubstrateView, locator: Locator): string | undefined {
  for (const node of matchingNodes(view.snapshot.nodes, locator)) {
    const entry = view.refs.byNode.get(node.nodeId);
    if (entry !== undefined) return entry.ref;
  }

  return undefined;
}

function fromAct(result: Extract<ActResult, { ok: false }>, index: number): UiRunResult {
  switch (result.code) {
    case "stale_ref":
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: stale ref`,
        details: { new_ref: result.new_ref },
      };
    case "not_interactive":
      return {
        ok: false,
        code: "op_broken",
        message: `step ${index}: ${result.reason ?? "target is covered"}`,
        details: {
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
          ...(result.blocker_ref !== undefined ? { blocker_ref: result.blocker_ref } : {}),
          ...(result.blocker_role !== undefined ? { blocker_role: result.blocker_role } : {}),
          ...(result.blocker_name !== undefined ? { blocker_name: result.blocker_name } : {}),
          ...(result.blocker_tag !== undefined ? { blocker_tag: result.blocker_tag } : {}),
          ...(result.blocker_text !== undefined ? { blocker_text: result.blocker_text } : {}),
          ...(result.blocker_dom_id !== undefined ? { blocker_dom_id: result.blocker_dom_id } : {}),
          ...(result.blocker_class !== undefined ? { blocker_class: result.blocker_class } : {}),
        },
      };
    case "invalid_request":
      return {
        ok: false,
        code: "invalid_params",
        message: `step ${index}: ${result.message}`,
      };
  }
}
