import { matchingNodes } from "@abubakarsiddiik/runtime";
import type { SemanticNode } from "@abubakarsiddiik/substrate";

import type { QaCase, QaCheck, QaLocator } from "./spec.js";

/** Failure codes whose cause is a locator that no longer resolves. */
export const REPAIRABLE_CODES = new Set(["not_found", "stale_ref", "not_interactive"]);

export type ReplacementOutcome =
  | { status: "resolves"; reason: string }
  | { status: "refused"; reason: string }
  | { status: "replaced"; locator: QaLocator; reason: string };

export type RepairChange = {
  phase: "setup" | "step" | "check";
  index: number;
  from: QaLocator;
  to: QaLocator;
};

export type RepairedSpec = {
  spec: QaCase;
  changes: RepairChange[];
};

/**
 * Find the node the broken locator meant, by name similarity over the
 * candidates its other fields still match.
 *
 * Recovery is deliberately conservative: an exact normalized-name match wins;
 * otherwise the best candidate must clear a margin over the runner-up. A
 * locator that resolves again on a fresh capture is a race, not drift, and
 * produces no edit.
 */
export function findReplacement(nodes: SemanticNode[], old: QaLocator): ReplacementOutcome {
  if (matchingNodes(nodes, old).length > 0) {
    return {
      status: "resolves",
      reason: "the target resolves again on a fresh capture; the failure was transient",
    };
  }

  if (old.test_id !== undefined) {
    return refused("a stale test_id has no anchor to recover by; update it by hand");
  }

  const relaxed = without(old, "name", "name_re", "label", "test_id", "ordinal");

  if (old.name_re !== undefined) {
    const matching = matchingNodes(nodes, relaxed).filter((node) =>
      new RegExp(old.name_re ?? "").test(node.name),
    );
    const best = matching[0];
    if (best === undefined) {
      return refused(`no candidate matches the name_re "${old.name_re}" anymore`);
    }
    return replaced(old, best, "matched the name_re pattern");
  }

  const anchor = old.name ?? old.label;
  if (anchor === undefined) {
    return refused("the locator has no name to recover by; add a name or a test_id");
  }

  // `matchingNodes` needs a role, label, or test_id to scope candidates; a
  // bare-name locator gathers every visible node instead.
  const inScope =
    old.role !== undefined
      ? matchingNodes(nodes, relaxed)
      : nodes.filter((candidate) => candidate.visible);

  if (inScope.length === 0 && old.role === undefined) {
    return refused("no node on the page matches the locator outside its name");
  }

  // The role matched nothing: the control's role drifted (button → link),
  // so widen to every visible node but demand an exact name match.
  const crossRole = old.role !== undefined && inScope.length === 0;
  const candidates = crossRole ? nodes.filter((candidate) => candidate.visible) : inScope;

  if (candidates.length === 0) {
    return refused("no node on the page matches the locator outside its name");
  }

  const scored = candidates
    .map((node) => ({ node, score: similarity(anchor, node.name) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (best === undefined || best.score < 0.6 || (crossRole && best.score < 1)) {
    return refused(
      `closest candidate was "${best?.node.name ?? "none"}" (${Math.round((best?.score ?? 0) * 100)}% similar); not confident enough to rewrite`,
    );
  }

  const exact = best.score === 1;
  const ahead = second === undefined || best.score - second.score >= 0.15;

  if (!exact && !ahead) {
    return refused(
      `"${best.node.name}" and "${second?.node.name}" are equally close to "${anchor}"; disambiguate the case by hand`,
    );
  }

  return replaced(old, best.node, exact ? "exact name match" : "best name match");
}

/**
 * Rewrite the broken locator — and every locator equal to it — into the
 * recovered one. Returns the edited spec plus where it changed.
 */
export function applyRepair(spec: QaCase, old: QaLocator, next: QaLocator): RepairedSpec {
  const changes: RepairChange[] = [];

  const editSteps = (steps: QaCase["steps"], phase: "setup" | "step"): QaCase["steps"] =>
    steps.map((step, index) => {
      if (!("target" in step) || step.target === undefined || !sameLocator(step.target, old)) {
        return step;
      }
      changes.push({ phase, index, from: step.target, to: next });
      return { ...step, target: next };
    });

  const editChecks = (checks: QaCheck[]): QaCheck[] =>
    checks.map((check, index) => {
      if ("visible" in check && sameLocator(check.visible, old)) {
        changes.push({ phase: "check", index, from: check.visible, to: next });
        return { visible: next };
      }
      if ("absent" in check && sameLocator(check.absent, old)) {
        changes.push({ phase: "check", index, from: check.absent, to: next });
        return { absent: next };
      }
      if ("value" in check && sameLocator(check.value.target, old)) {
        changes.push({ phase: "check", index, from: check.value.target, to: next });
        return { value: { ...check.value, target: next } };
      }
      return check;
    });

  return {
    spec: {
      ...spec,
      setup: editSteps(spec.setup, "setup"),
      steps: editSteps(spec.steps, "step"),
      expect: editChecks(spec.expect),
    },
    changes,
  };
}

function without(locator: QaLocator, ...keys: string[]): QaLocator {
  const copy: Record<string, unknown> = { ...locator };
  for (const key of keys) delete copy[key];
  return copy as QaLocator;
}

function replaced(old: QaLocator, node: SemanticNode, why: string): ReplacementOutcome {
  const locator: QaLocator = {
    role: node.role,
    name: node.name,
    ...(old.ctx !== undefined ? { ctx: old.ctx } : {}),
  };
  return { status: "replaced", locator, reason: `${why}: ${describe(old)} → ${describe(locator)}` };
}

function refused(reason: string): ReplacementOutcome {
  return { status: "refused", reason };
}

function describe(locator: QaLocator): string {
  return `{${locator.role ?? "*"} "${locator.name ?? locator.name_re ?? locator.label ?? locator.test_id ?? "?"}"}`;
}

function sameLocator(a: QaLocator, b: QaLocator): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Name similarity of two labels: 1 means identical.
 *
 * Levenshtein ratio, raised by token containment — "email" inside
 * "email address" is a truncation of the same label, not a different
 * control — so a rename that keeps any word of the old name scores high
 * while a semantic rewrite ("Login" → "Sign in") stays below the bar.
 */
export function similarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  return Math.max(levenshteinRatio(left, right), tokenScore(left, right));
}

function tokenScore(left: string, right: string): number {
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared === 0) return 0;

  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;

  // Every word of the shorter label appears in the longer one: a truncation.
  return shared === smaller && smaller < union ? 0.9 : shared / union;
}

function levenshteinRatio(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  const distance = previous[right.length] ?? 0;
  return 1 - distance / Math.max(left.length, right.length);
}
