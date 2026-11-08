import type { ModelPort, ObjectResult, Usage } from "@portolan/model";

import type { Decision } from "./types.js";

/**
 * A deterministic ModelPort for tests and smoke runs. It ignores the prompt and
 * returns the next scripted decision, so the runner can be exercised without a
 * provider key.
 */
export function createScriptedModel(decisions: Decision[]): ModelPort {
  let index = 0;
  const usage: Usage = {
    input: 0,
    cached_input: 0,
    output: 0,
    provider: "scripted",
    model: "scripted",
  };

  return {
    async object<T>(): Promise<ObjectResult<T>> {
      const decision = decisions[index];
      index += 1;
      if (!decision) throw new Error("scripted model ran out of decisions");
      return { value: decision as T, usage };
    },
    async agent() {
      throw new Error("scripted model does not implement agent()");
    },
  };
}
