import type { ModelPort, ObjectResult, Usage } from "@portolan/model";

import type { Decision } from "./types.js";

export type SubstrateAct = "click" | "check" | "uncheck" | "fill" | "select" | "press";

export type SubstrateStep =
  | { kind: "view" }
  | {
      kind: "act";
      role: string;
      name: string;
      do: SubstrateAct;
      value?: string;
      key?: string;
    }
  | { kind: "read"; ref?: string }
  | { kind: "done"; answer: string };

const USAGE: Usage = {
  input: 0,
  cached_input: 0,
  output: 0,
  provider: "scripted",
  model: "substrate-script",
};

/**
 * A deterministic model for arm C.
 *
 * It names affordances by role and name, then asks the backend for the ref of
 * the latest view. That is the same information a model gets from `view`, so
 * the script exercises the affordance loop rather than a hidden locator.
 */
export function createSubstrateModel(
  steps: SubstrateStep[],
  resolveRef: (role: string, name: string) => string | undefined,
): ModelPort {
  let index = 0;

  return {
    async object<T>(): Promise<ObjectResult<T>> {
      const step = steps[index];
      index += 1;

      if (step === undefined) throw new Error("substrate script ran out of steps");

      return { value: toDecision(step, resolveRef) as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the substrate script does not implement agent()");
    },
  };
}

function toDecision(
  step: SubstrateStep,
  resolveRef: (role: string, name: string) => string | undefined,
): Decision {
  switch (step.kind) {
    case "view":
      return {
        thought: "Look at the affordances.",
        tool: "view",
        arguments: {},
        answer: "",
      };
    case "read":
      return {
        thought: "Read the page.",
        tool: "read",
        arguments: step.ref === undefined ? {} : { ref: step.ref },
        answer: "",
      };
    case "done":
      return { thought: "Done.", tool: "", arguments: {}, answer: step.answer };
    case "act": {
      const ref = resolveRef(step.role, step.name);
      if (ref === undefined) {
        throw new Error(`no ${step.role} named "${step.name}" on the current page`);
      }

      return {
        thought: `${step.do} ${step.role} "${step.name}".`,
        tool: "act",
        arguments: {
          ref,
          do: step.do,
          ...(step.value !== undefined ? { value: step.value } : {}),
          ...(step.key !== undefined ? { key: step.key } : {}),
        },
        answer: "",
      };
    }
  }
}
