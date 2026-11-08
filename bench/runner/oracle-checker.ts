import type { ExpandedTask } from "../tasks/load.js";
import type { StepRecord, SuccessChecker, ToolBackend } from "./types.js";

type EvaluateEnvelope = {
  ok?: boolean;
  value?: unknown;
};

/**
 * Checks a task's success predicate against the live oracle page.
 *
 * URL and DOM clauses use the oracle's `evaluate` tool. Download clauses are
 * checked against the tool results the runner already recorded, because a
 * download does not navigate the page.
 */
export class OracleSuccessChecker implements SuccessChecker {
  constructor(private readonly backend: ToolBackend) {}

  async check(
    task: ExpandedTask,
    steps: StepRecord[],
  ): Promise<{ success: boolean; detail?: string }> {
    const predicate = task.success;

    if (predicate.download) {
      const text = steps.map((step) => step.result.text).join("\n");
      if (
        predicate.download.filename_matches &&
        !text.includes(predicate.download.filename_matches)
      ) {
        return { success: false, detail: "download filename did not match" };
      }
      if (predicate.download.contains && !text.includes(predicate.download.contains)) {
        return { success: false, detail: "download content did not match" };
      }
    }

    if (predicate.url_matches) {
      const url = await this.evaluate("location.href");
      if (typeof url !== "string") return { success: false, detail: "no url" };
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      if (!new RegExp(predicate.url_matches).test(path)) {
        return { success: false, detail: `url ${path} did not match ${predicate.url_matches}` };
      }
    }

    if (predicate.dom) {
      const value = await this.evaluate(predicate.dom);
      if (!value) return { success: false, detail: `dom predicate failed: ${predicate.dom}` };
    }

    if (predicate.extracted) {
      for (const [name, selector] of Object.entries(predicate.extracted)) {
        const value = await this.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
        );
        if (typeof value !== "string" || value.trim() === "") {
          return { success: false, detail: `extracted ${name} missing` };
        }
      }
    }

    return { success: true };
  }

  private async evaluate(expression: string): Promise<unknown> {
    const result = await this.backend.callTool("evaluate", { expression });
    if (!result.ok) throw new Error(result.text);
    const envelope = JSON.parse(result.text) as EvaluateEnvelope;
    return envelope.value;
  }
}
