import type { RepairDecision } from "@portolan/compiler";
import type { ModelPort, ObjectRequest, Usage } from "@portolan/model";

export type ScriptStep =
  | { kind: "act"; role: string; name: string; do: "click" | "fill" | "select"; value?: string }
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

  if (ref === undefined || ref.length === 0) {
    throw new Error(`no ${role} named "${name}" in the observation`);
  }

  return ref;
}

/** A deterministic repair model that names affordances by role and name. */
export function createRepairScript(steps: ScriptStep[]): ModelPort {
  let index = 0;

  return {
    async object<T>(req: ObjectRequest): Promise<{ value: T; usage: Usage }> {
      const step = steps[index];
      index += 1;
      if (step === undefined) throw new Error("repair script ran out of steps");

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
