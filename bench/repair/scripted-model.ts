import type { RepairDecision } from "@portolan/compiler";
import type { ModelPort, ObjectRequest, Usage } from "@portolan/model";

import type { Decision } from "../runner/types.js";

export type ScriptStep =
  | {
      kind: "act";
      role: string;
      name: string;
      do: "click" | "fill" | "select" | "check";
      value?: string;
    }
  | { kind: "view" }
  | { kind: "read"; ref?: string }
  | { kind: "done"; answer: string };

const USAGE: Usage = {
  input: 0,
  cached_input: 0,
  output: 0,
  provider: "scripted",
  model: "scripted",
};

/**
 * Resolve a role and name to the ref in the observation, the same way a model
 * reads the affordance list. The prompt has one line per affordance:
 * `e1a2b textbox "Search products"`.
 */
export function refFromPrompt(prompt: string, role: string, name: string): string {
  const needle = `${role} ${JSON.stringify(name)}`;
  const line = prompt.split("\n").find((candidate) => candidate.includes(needle));
  const ref = line?.trim().split(" ")[0];

  if (ref !== undefined && ref.length > 0) return ref;

  const matches = [...prompt.matchAll(/"affordances":(\[[\s\S]*?\])/g)];

  for (const match of matches.reverse()) {
    try {
      const list = JSON.parse(match[1] ?? "") as Array<{
        ref?: string;
        role?: string;
        name?: string;
      }>;
      const found = list.find((item) => item.role === role && item.name === name);
      if (found?.ref !== undefined) return found.ref;
    } catch {
      // A truncated JSON block is not the latest complete view.
    }
  }

  throw new Error(`no ${role} named "${name}" in the observation`);
}

/** A deterministic runner model: the same script, shaped as a Decision. */
export function createRunnerScript(steps: ScriptStep[]): ModelPort {
  let index = 0;

  return {
    async object<T>(req: ObjectRequest): Promise<{ value: T; usage: Usage }> {
      const step = steps[index];
      index += 1;
      if (step === undefined) throw new Error("runner script ran out of steps");

      if (step.kind === "view") {
        const decision: Decision = {
          thought: "Look.",
          tool: "view",
          arguments: { format: "both" },
          answer: "",
        };
        return { value: decision as T, usage: USAGE };
      }

      if (step.kind === "read") {
        const decision: Decision = {
          thought: "Read.",
          tool: "read",
          arguments: step.ref === undefined ? {} : { ref: step.ref },
          answer: "",
        };
        return { value: decision as T, usage: USAGE };
      }

      if (step.kind === "done") {
        const decision: Decision = {
          thought: "Done.",
          tool: "",
          arguments: {},
          answer: step.answer,
        };
        return { value: decision as T, usage: USAGE };
      }

      const decision: Decision = {
        thought: `${step.do} ${step.role} "${step.name}".`,
        tool: "act",
        arguments: {
          ref: refFromPrompt(req.prompt, step.role, step.name),
          do: step.do,
          ...(step.value !== undefined ? { value: step.value } : {}),
        },
        answer: "",
      };

      return { value: decision as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the runner script does not implement agent()");
    },
  };
}

/** A deterministic repair model that names affordances by role and name. */
export function createRepairScript(steps: ScriptStep[]): ModelPort {
  let index = 0;

  return {
    async object<T>(req: ObjectRequest): Promise<{ value: T; usage: Usage }> {
      const step = steps[index];
      index += 1;
      if (step === undefined) throw new Error("repair script ran out of steps");

      if (step.kind === "view") {
        return {
          value: { thought: "Look.", tool: "view", arguments: {}, answer: "" } as T,
          usage: USAGE,
        };
      }

      if (step.kind === "read") {
        return {
          value: {
            thought: "Read.",
            tool: "read",
            ...(step.ref !== undefined ? { ref: step.ref } : {}),
            answer: "",
          } as T,
          usage: USAGE,
        };
      }

      const decision: RepairDecision =
        step.kind === "done"
          ? { thought: "Done.", tool: "done", answer: step.answer }
          : {
              thought: `${step.do} ${step.role} "${step.name}".`,
              tool: "act",
              ref: refFromPrompt(req.prompt, step.role, step.name),
              do: step.do,
              ...(step.value !== undefined ? { value: step.value } : {}),
            };

      return { value: decision as T, usage: USAGE };
    },
    async agent() {
      throw new Error("the repair script does not implement agent()");
    },
  };
}
