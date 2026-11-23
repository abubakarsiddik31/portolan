import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PolicyRule, ruleMatchesLabel, ruleReason } from "@abubakarsiddiik/substrate";
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

/**
 * Shipped exclusion rules, matched on a control's label. A site's own
 * `policies/<site>.json` rules are added to these. A notifications bell or a
 * suggested question ending in "?" are ordinary controls and are not listed.
 */
export const DEFAULT_RULES: PolicyRule[] = [
  { category: "session", label: "\\b(sign out|log ?out|logout)\\b", reason: "ends the session" },
  {
    category: "destructive",
    label: "\\b(delete|remove|destroy|revoke)\\b",
    reason: "removes data",
  },
  {
    category: "billing",
    label: "\\b(upgrade|purchase|buy|billing|payment|checkout|subscribe)\\b",
    reason: "changes what the account pays",
  },
  {
    category: "layout",
    label: "\\btoggle (sidebar|menu|navigation)\\b",
    reason: "page chrome",
  },
  { category: "layout", label: "^(menu|close|dismiss)$", reason: "page chrome" },
  { category: "layout", label: "^\\d+$", reason: "a page or row number" },
  { category: "layout", label: "^(USD|BDT|EUR|GBP|CAD|AUD)$", reason: "a currency label" },
];

export type BuildCapabilitiesInput = {
  site: string;
  /** The live surface from the last discovery, when there was one. */
  discovery?: DomDiscovery;
  /** Every candidate op, from any source. */
  proposals: OpProposal[];
  /** The previous ledger; code/manual entries survive and vanished live ones go stale. */
  previous?: CapabilityLedger;
  /** Extra label patterns (`--exclude`), recorded under the category `manual`. */
  exclude?: string[];
  /** The site policy's rules, added to {@link DEFAULT_RULES}. */
  rules?: PolicyRule[];
  /** Collapse a layout control seen on many pages into one capability. Default true. */
  dedupe?: boolean;
  /** Proposals that failed or skipped verification, by op name, with the reason. */
  unverified?: Map<string, string>;
  /** Ops that passed verification in this run, for `last_verified`. */
  verified?: Set<string>;
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
  const exclude: PolicyRule[] = [
    ...DEFAULT_RULES,
    ...(input.rules ?? []),
    ...(input.exclude ?? []).map((label) => ({ category: "manual", label })),
  ];
  const previous = new Map((input.previous?.capabilities ?? []).map((item) => [item.id, item]));
  const next = new Map<string, Capability>();
  const unverified = input.unverified ?? new Map<string, string>();
  const superseded = new Set<string>();
  const now = input.now ?? new Date().toISOString();

  if (input.discovery !== undefined) {
    const seen = new Set<string>();

    const grouped = groupGlobals(input.discovery.surface, input.dedupe !== false);
    // The per-page entries an earlier ledger held for a control that is now
    // global are superseded, not removed.
    for (const id of grouped.superseded) superseded.add(id);

    for (const action of grouped.actions) {
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
      const excludedBy = exclude.find((rule) => ruleMatchesLabel(rule, action.name));

      let status: CapabilityStatus = "missing";
      let reason: string | undefined;
      let precondition: string | undefined;
      let category: string | undefined;

      if (proposal !== undefined) {
        status = "mapped";
      } else if (failed !== undefined) {
        reason = unverified.get(failed.op.name);
        // An op that used to work and now fails on a page that changed is
        // stale; a control that never had a working op is just missing.
        if (previousItem?.status === "mapped") status = "stale";
      } else if (excludedBy !== undefined) {
        status = "excluded";
        reason = `${ruleReason(excludedBy)}; record it manually if it is safe`;
        category = excludedBy.category;
      } else if (action.disabled === true) {
        status = "unavailable";
        precondition = `disabled on ${action.page} in this data`;
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
        ...(precondition !== undefined ? { precondition } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(action.pages !== undefined ? { pages: action.pages } : {}),
        ...(action.sample !== undefined ? { sample: action.sample } : {}),
        last_seen: now,
        ...lastVerified(
          proposal !== undefined && input.verified?.has(proposal.op.name) === true
            ? now
            : previousItem?.last_verified,
        ),
        ...(status === "stale" ? { stale_since: previousItem?.stale_since ?? now } : {}),
      });
    }
  }

  for (const [id, item] of previous) {
    if (next.has(id) || superseded.has(id)) continue;

    if (item.source !== "live") {
      next.set(id, item);
      continue;
    }

    // Only a crawl that reached the page can say the control is gone. A run
    // with no crawl, or one that started elsewhere, observed nothing about it,
    // so the old entry stands, upgraded when a verified op now covers it.
    const crawled = input.discovery?.pages?.includes(item.page) === true;
    if (!crawled) {
      const proposal = input.proposals.find(
        (candidate) =>
          !unverified.has(candidate.op.name) &&
          covers(
            {
              page: item.page,
              kind: item.trigger.kind,
              name: item.trigger.name,
              ...(item.trigger.target !== undefined ? { target: item.trigger.target } : {}),
            },
            candidate,
          ),
      );
      if (item.status === "missing" && proposal !== undefined) {
        const { reason: _gap, ...rest } = item;
        next.set(id, { ...rest, status: "mapped", op: proposal.op.name });
      } else {
        next.set(id, item);
      }
      continue;
    }

    next.set(id, {
      ...item,
      status: "removed",
      reason: "not seen on its page in this run; the map keeps the old op",
      stale_since: item.stale_since ?? now,
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
  const counts = { mapped: 0, missing: 0, excluded: 0, stale: 0, unavailable: 0, removed: 0 };
  for (const item of ledger.capabilities) counts[item.status] += 1;

  const total = ledger.capabilities.length;
  const denominator = counts.mapped + counts.missing;
  const ratio = denominator === 0 ? 1 : counts.mapped / denominator;

  return { total, ...counts, ratio };
}

/** Controls that exist but could not be used with the data the crawl saw. */
export function unavailableOf(ledger: CapabilityLedger): Capability[] {
  return ledger.capabilities.filter((item) => item.status === "unavailable");
}

/**
 * Entries no crawl has seen within `maxAgeMs`, or ever. A partial crawl leaves
 * the rest of the map untouched, so this is how to find what to re-check.
 */
export function agedOf(ledger: CapabilityLedger, maxAgeMs: number, now = Date.now()): Capability[] {
  return ledger.capabilities.filter((item) => {
    if (item.status === "excluded") return false;
    const seen = item.last_seen === undefined ? Number.NaN : Date.parse(item.last_seen);
    return Number.isNaN(seen) || now - seen > maxAgeMs;
  });
}

function lastVerified(at: string | undefined): { last_verified?: string } {
  return at === undefined ? {} : { last_verified: at };
}

export function gapsOf(ledger: CapabilityLedger): Capability[] {
  return ledger.capabilities.filter(
    (item) => item.status === "missing" || item.status === "stale" || item.status === "removed",
  );
}

export function formatCoverage(coverage: CapabilityCoverage): string {
  const actionable = coverage.mapped + coverage.missing;
  const percent =
    actionable === 0 ? "nothing actionable" : `${Math.round(coverage.ratio * 100)}% of actionable`;
  const unavailable = coverage.unavailable > 0 ? `, ${coverage.unavailable} unavailable` : "";
  const removed = coverage.removed > 0 ? `, ${coverage.removed} removed` : "";
  return `${coverage.mapped} mapped, ${coverage.missing} missing, ${coverage.excluded} excluded, ${coverage.stale} stale${removed}${unavailable} (${percent})`;
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

type GroupedAction = SurfaceAction & { pages?: string[] };

const GLOBAL_MIN_PAGES = 3;

/**
 * A layout control (account menu, "Back to workspace") appears on every page
 * and used to become one capability and one op per page. Collapse a control
 * that sits in a landmark on `GLOBAL_MIN_PAGES` or more pages into one entry
 * that lists them.
 */
function groupGlobals(
  surface: SurfaceAction[],
  enabled: boolean,
): { actions: GroupedAction[]; superseded: string[] } {
  if (!enabled) return { actions: surface, superseded: [] };

  const groups = new Map<string, SurfaceAction[]>();
  for (const action of surface) {
    if (action.kind === "link" || action.landmark === undefined) continue;
    const key = `${action.kind}\u0000${action.name.toLowerCase()}\u0000${action.landmark}`;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }

  const merged = new Set<SurfaceAction>();
  const actions: GroupedAction[] = [];
  const superseded: string[] = [];

  for (const members of groups.values()) {
    const pages = [...new Set(members.map((member) => member.page))].sort();
    if (pages.length < GLOBAL_MIN_PAGES) continue;

    const first = members[0];
    if (first === undefined) continue;
    for (const member of members) {
      merged.add(member);
      superseded.push(makeCapabilityId(member));
    }
    const enabledSomewhere = members.some((member) => member.disabled !== true);
    const { disabled: _off, ...rest } = first;
    actions.push({
      ...rest,
      page: pages[0] ?? first.page,
      pages,
      ...(enabledSomewhere ? {} : { disabled: true }),
    });
  }

  return { actions: [...surface.filter((action) => !merged.has(action)), ...actions], superseded };
}

/** True when a recorded control name fits an observed one, which may be a template. */
function nameMatches(observed: string, recorded: string): boolean {
  if (!observed.includes("{")) return observed.toLowerCase() === recorded.toLowerCase();

  const source = observed
    .replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === "{" || char === "}" ? char : `\\${char}`))
    .replace(/\{count\}/g, "\\d+")
    .replace(/\{email\}/g, "\\S+@\\S+\\.\\S+");
  return new RegExp(`^${source}$`, "i").test(recorded);
}

function onPage(action: GroupedAction, pages: string[]): boolean {
  return (action.pages ?? [action.page]).some((page) => pages.includes(page));
}

function covers(action: GroupedAction, proposal: OpProposal): boolean {
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
    nameMatches(action.name, trigger.name) &&
    onPage(action, [trigger.page])
  ) {
    return true;
  }

  // A recorded run has no trigger metadata, but its ui steps still name the
  // button it clicked.
  if (action.kind !== "button" || !onPage(action, proposal.op.from)) return false;

  return proposal.op.impls.some(
    (impl) =>
      impl.tier === "ui" &&
      impl.steps.some(
        (step) =>
          step.do === "click" &&
          nameMatches(action.name, step.target.name ?? "") &&
          step.target.role === "button",
      ),
  );
}

/** The stable id for one observed action, before any duplicate suffix. */
export function makeCapabilityId(action: {
  page: string;
  kind: SurfaceAction["kind"];
  name: string;
  target?: string;
  pages?: string[];
}): string {
  // A navigation target is the same capability on every page that links to it.
  // Buttons and forms are page-specific because the same label can mean
  // different work in different places.
  if (action.kind === "link" && action.target !== undefined) return `link.${action.target}`;
  if (action.pages !== undefined) return `global.${action.kind}.${slug(action.name, "action")}`;
  return `${action.page}.${action.kind}.${slug(action.name, "action")}`;
}

function uniqueCapabilityId(action: GroupedAction, seen: Set<string>): string {
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
