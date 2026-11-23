import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DomDiscovery } from "./dom.js";
import { slug } from "./draft.js";
import type {
  Capability,
  CapabilityCoverage,
  CapabilityLedger,
  CapabilityStatus,
  OpProposal,
  SurfaceAction,
} from "./types.js";

export const CAPABILITIES_FILE = "capabilities.json";

/** Irreversible or account-level actions we never auto-run. */
const DEFAULT_EXCLUDE: RegExp[] = [
  /\b(sign out|log ?out|logout)\b/i,
  /\b(delete|remove|destroy|revoke)\b/i,
  /\b(upgrade|purchase|buy|billing|payment|checkout|subscribe)\b/i,
  /\btoggle (sidebar|menu|navigation)\b/i,
  /^(notifications?|\d+)$/i,
  /^(menu|close|dismiss)$/i,
  /\?$/,
  /^(USD|BDT|EUR|GBP|CAD|AUD)$/i,
];

export type BuildCapabilitiesInput = {
  site: string;
  /** The live surface from the last discovery, when there was one. */
  discovery?: DomDiscovery;
  /** Every candidate op, from any source. */
  proposals: OpProposal[];
  /** The previous ledger; code/manual entries survive and vanished live ones go stale. */
  previous?: CapabilityLedger;
  /** Extra exclusion patterns, appended to the defaults. */
  exclude?: string[];
  /** Proposals that failed or skipped verification, by op name, with the reason. */
  unverified?: Map<string, string>;
  now?: string;
};

/**
 * Reconcile the observed surface with the draft ops.
 *
 * A capability is `mapped` only when a proposal covers the same trigger, so a
 * page-level read op never silently counts as a button or a form. Anything the
 * live app shows but the map does not cover is `missing`; destructive actions
 * are `excluded` with a reason. A proposal named in `unverified` covers nothing:
 * its trigger is `missing` and the verification failure is the reason.
 */
export function buildCapabilities(input: BuildCapabilitiesInput): CapabilityLedger {
  const exclude = [
    ...DEFAULT_EXCLUDE,
    ...(input.exclude ?? []).map((pattern) => new RegExp(pattern, "i")),
  ];
  const previous = new Map((input.previous?.capabilities ?? []).map((item) => [item.id, item]));
  const next = new Map<string, Capability>();
  const unverified = input.unverified ?? new Map<string, string>();

  if (input.discovery !== undefined) {
    const seen = new Set<string>();

    for (const action of input.discovery.surface) {
      const id = uniqueCapabilityId(action, seen);
      const previousItem = previous.get(id);

      // A human or agent decision recorded as `manual` outlives rediscovery.
      if (previousItem?.source === "manual") {
        next.set(id, previousItem);
        continue;
      }

      const covering = input.proposals.filter((candidate) => covers(action, candidate));
      const proposal = covering.find((candidate) => !unverified.has(candidate.op.name));
      const failed = covering.find((candidate) => unverified.has(candidate.op.name));
      const excludedBy = exclude.find((pattern) => pattern.test(action.name));

      let status: CapabilityStatus = "missing";
      let reason: string | undefined;

      if (proposal !== undefined) {
        status = "mapped";
      } else if (failed !== undefined) {
        reason = unverified.get(failed.op.name);
      } else if (excludedBy !== undefined) {
        status = "excluded";
        reason = "matches an exclusion pattern; record it manually if it is safe";
      }

      next.set(id, {
        id,
        page: action.page,
        trigger: {
          kind: action.kind,
          name: action.name,
          ...(action.target !== undefined ? { target: action.target } : {}),
        },
        status,
        source: "live",
        ...(proposal !== undefined ? { op: proposal.op.name } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
    }
  }

  for (const [id, item] of previous) {
    if (next.has(id)) continue;

    if (item.source !== "live") {
      next.set(id, item);
      continue;
    }

    next.set(id, {
      ...item,
      status: "stale",
      reason: "not observed in this run; the map keeps the old op",
    });
  }

  const capabilities = [...next.values()].sort(
    (a, b) => a.page.localeCompare(b.page) || a.trigger.name.localeCompare(b.trigger.name),
  );

  return {
    schema: 1,
    site: input.site,
    generated_at: input.now ?? new Date().toISOString(),
    capabilities,
  };
}

export function coverageOf(ledger: CapabilityLedger): CapabilityCoverage {
  const counts = { mapped: 0, missing: 0, excluded: 0, stale: 0 };
  for (const item of ledger.capabilities) counts[item.status] += 1;

  const total = ledger.capabilities.length;
  const denominator = counts.mapped + counts.missing;
  const ratio = denominator === 0 ? 1 : counts.mapped / denominator;

  return { total, ...counts, ratio };
}

export function gapsOf(ledger: CapabilityLedger): Capability[] {
  return ledger.capabilities.filter((item) => item.status === "missing" || item.status === "stale");
}

export function formatCoverage(coverage: CapabilityCoverage): string {
  const actionable = coverage.mapped + coverage.missing;
  const percent =
    actionable === 0 ? "nothing actionable" : `${Math.round(coverage.ratio * 100)}% of actionable`;
  return `${coverage.mapped} mapped, ${coverage.missing} missing, ${coverage.excluded} excluded, ${coverage.stale} stale (${percent})`;
}

export function writeCapabilities(dir: string, ledger: CapabilityLedger): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CAPABILITIES_FILE);
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return path;
}

export function readCapabilities(dir: string): CapabilityLedger | undefined {
  const path = join(dir, CAPABILITIES_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as CapabilityLedger;
}

function covers(action: SurfaceAction, proposal: OpProposal): boolean {
  // A navigation link is covered by a url op for its target, wherever the link
  // appears. Counting it only on the page where it was first discovered made
  // every global nav link look missing on every other page.
  if (
    action.kind === "link" &&
    action.target !== undefined &&
    proposal.op.effect === "read" &&
    proposal.op.to.includes(action.target) &&
    proposal.op.impls.some((impl) => impl.tier === "url")
  ) {
    return true;
  }

  const trigger = proposal.trigger;
  if (
    trigger !== undefined &&
    trigger.kind === action.kind &&
    trigger.name.toLowerCase() === action.name.toLowerCase() &&
    trigger.page === action.page
  ) {
    return true;
  }

  // A recorded run has no trigger metadata, but its ui steps still name the
  // button it clicked.
  if (action.kind !== "button" || !proposal.op.from.includes(action.page)) return false;

  return proposal.op.impls.some(
    (impl) =>
      impl.tier === "ui" &&
      impl.steps.some(
        (step) =>
          step.do === "click" && step.target.name === action.name && step.target.role === "button",
      ),
  );
}

/** The stable id for one observed action, before any duplicate suffix. */
export function makeCapabilityId(action: {
  page: string;
  kind: SurfaceAction["kind"];
  name: string;
  target?: string;
}): string {
  // A navigation target is the same capability on every page that links to it.
  // Buttons and forms are page-specific because the same label can mean
  // different work in different places.
  return action.kind === "link" && action.target !== undefined
    ? `link.${action.target}`
    : `${action.page}.${action.kind}.${slug(action.name, "action")}`;
}

function uniqueCapabilityId(action: SurfaceAction, seen: Set<string>): string {
  const base = makeCapabilityId(action);
  let id = base;
  let suffix = 2;
  while (seen.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}
