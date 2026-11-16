export type PlanReason = {
  id: string;
  reasons: string[];
  selected: boolean;
};

export type Plan = {
  changedFiles: string[];
  selected: string[];
  omitted: string[];
  reasons: PlanReason[];
  unverified: string[];
};

export type PlanInput = {
  cases: Array<{
    id: string;
    status: string;
    tags: string[];
    touches: string[];
  }>;
  changedFiles: string[];
  max?: number;
  includeSmoke?: boolean;
  includeQuarantined?: boolean;
};

/**
 * Choose the cases a diff affects.
 *
 * Matching is deliberately simple and explainable: a `touches` glob hit, or a
 * `smoke` tag. A case with no globs is never selected by a diff — run it
 * explicitly or tag it smoke. The cap reports what it dropped.
 */
export function planCases(input: PlanInput): Plan {
  const max = input.max ?? 50;
  const includeSmoke = (input.includeSmoke ?? true) && input.changedFiles.length > 0;
  const includeQuarantined = input.includeQuarantined ?? false;
  const reasons: PlanReason[] = [];
  const selected: string[] = [];

  for (const item of input.cases) {
    const reasonsForCase: string[] = [];

    if (item.status === "disabled" || item.status === "orphaned") {
      reasons.push({ id: item.id, reasons: [`skip:${item.status}`], selected: false });
      continue;
    }

    if (item.status === "quarantined" && !includeQuarantined) {
      reasons.push({ id: item.id, reasons: ["skip:quarantined"], selected: false });
      continue;
    }

    if (includeSmoke && item.tags.includes("smoke")) {
      reasonsForCase.push("smoke");
    }

    for (const pattern of item.touches) {
      const hit = input.changedFiles.find((file) => globHit(pattern, file));
      if (hit !== undefined) reasonsForCase.push(`touch:${hit}`);
    }

    if (reasonsForCase.length === 0) {
      reasons.push({ id: item.id, reasons: [], selected: false });
      continue;
    }

    reasons.push({ id: item.id, reasons: reasonsForCase, selected: true });
    selected.push(item.id);
  }

  const capped = selected.slice(0, max);
  const omitted = selected.slice(max);

  return {
    changedFiles: input.changedFiles,
    selected: capped,
    omitted,
    reasons: reasons.filter((item) => item.selected || item.reasons.length > 0),
    unverified: [],
  };
}

/** Reuse the case glob matcher without importing the whole spec module. */
function globHit(pattern: string, value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const source = pattern.replace(/\\/g, "/");
  let regex = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "*" && next === "*") {
      if (source[index + 2] === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += char !== undefined && /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }

  return new RegExp(`^${regex}$`).test(normalized);
}
