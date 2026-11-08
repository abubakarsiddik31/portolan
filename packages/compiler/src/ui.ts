import type { Extractor, Locator, UiStep } from "@portolan/protocol";

import type { ParameterizedSegment } from "./parameterize.js";
import type { InferredReturns } from "./returns.js";

export type UiLift = {
  steps: UiStep[];
  extract: Extractor;
  params: string[];
};

/**
 * Lift a segment with no cheaper tier to a `ui` program.
 *
 * The trace already carries the semantic locator of every action, so the
 * steps are the actions with bound values replaced by `{name}` placeholders.
 * A file input is a `fill` with a path; the engine already turns that into
 * `DOM.setFileInputFiles`.
 */
export function liftUi(input: {
  segment: ParameterizedSegment;
  returns: InferredReturns;
}): UiLift | undefined {
  const steps: UiStep[] = [];
  const params = new Set<string>();

  for (const action of input.segment.segment.actions) {
    if (action.locator === undefined) continue;

    const target: Locator = {
      role: action.locator.role,
      name: action.locator.name,
      ordinal: action.locator.ordinal,
    };

    if (action.do === "click" || action.do === "check" || action.do === "uncheck") {
      steps.push({ do: action.do, target });
      continue;
    }

    if (action.do === "press") {
      if (action.key !== undefined) steps.push({ do: "press", key: action.key });
      continue;
    }

    if (action.do !== "fill" && action.do !== "select") continue;
    if (action.value === undefined) continue;

    const binding = input.segment.params.find((param) => String(param.value) === action.value);

    if (binding !== undefined) {
      params.add(binding.name);
      steps.push({ do: action.do, target, value: `{${binding.name}}` });
    } else {
      steps.push({ do: action.do, target, value: action.value });
    }
  }

  if (steps.length === 0) return undefined;

  return { steps, extract: input.returns.extractor, params: [...params] };
}
