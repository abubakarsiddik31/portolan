import type { CompiledCandidate } from "@abubakarsiddiik/compiler";
import {
  type PolicyRule,
  ruleMatchesLabel,
  ruleMatchesRequest,
  ruleReason,
} from "@abubakarsiddiik/substrate";

/** Categories that must not run during an unattended build without `--allow-cost`. */
const GATED = new Set(["cost", "destructive"]);

/**
 * The first `cost` or `destructive` rule a recorded run tripped: a request
 * its actions fired, or the label of a control it used. The trace is
 * evidence of what the control really does, which its name cannot be.
 */
export function riskOf(
  candidate: CompiledCandidate,
  rules: PolicyRule[],
): { category: string; reason: string } | undefined {
  const gated = rules.filter((rule) => GATED.has(rule.category));
  if (gated.length === 0) return undefined;

  for (const action of candidate.segment.segment.actions) {
    for (const rule of gated) {
      const name = action.locator?.name;
      if (name !== undefined && ruleMatchesLabel(rule, name)) {
        return { category: rule.category, reason: ruleReason(rule) };
      }

      for (const effect of action.effects) {
        if (
          effect.kind === "network" &&
          effect.method !== undefined &&
          ruleMatchesRequest(rule, effect.method, effect.url)
        ) {
          return { category: rule.category, reason: ruleReason(rule) };
        }
      }
    }
  }

  return undefined;
}
