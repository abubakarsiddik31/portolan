import type { SiteMap } from "@abubakarsiddiik/protocol";

import { coverageOf, formatCoverage } from "./capabilities.js";
import type { Capability, CapabilityLedger } from "./types.js";

export type CoverageDiff = {
  /** Missing now, and not missing before (or not there at all). */
  new_missing: Capability[];
  /** In the baseline, gone from the ledger. */
  dropped: Capability[];
  /** Stale or removed now, and not before. */
  newly_stale: Capability[];
  /** Mapped now, and not before. */
  newly_mapped: Capability[];
  /** Became unavailable (disabled) since the baseline. */
  newly_unavailable: Capability[];
};

export type OpsDiff = { added: string[]; removed: string[]; changed: string[] };

/** What changed in the ledger since a baseline. Without one, everything is new. */
export function diffLedgers(
  base: CapabilityLedger | undefined,
  current: CapabilityLedger,
): CoverageDiff {
  const before = new Map((base?.capabilities ?? []).map((item) => [item.id, item]));
  const now = new Map(current.capabilities.map((item) => [item.id, item]));
  const changed = (item: Capability, status: Capability["status"][]) =>
    status.includes(item.status) && !status.includes(before.get(item.id)?.status ?? "excluded");

  return {
    new_missing: current.capabilities.filter((item) => changed(item, ["missing"])),
    dropped: [...before.values()].filter((item) => !now.has(item.id) && item.status !== "excluded"),
    newly_stale: current.capabilities.filter((item) => changed(item, ["stale", "removed"])),
    newly_mapped: current.capabilities.filter(
      (item) => item.status === "mapped" && before.get(item.id)?.status !== "mapped",
    ),
    newly_unavailable: current.capabilities.filter((item) => changed(item, ["unavailable"])),
  };
}

/** Ops added, removed, or changed between two published map versions. */
export function diffOps(before: SiteMap, after: SiteMap): OpsDiff {
  const was = new Map(before.ops.map((op) => [op.name, JSON.stringify({ ...op, status: "" })]));
  const is = new Map(after.ops.map((op) => [op.name, JSON.stringify({ ...op, status: "" })]));

  return {
    added: [...is.keys()].filter((name) => !was.has(name)),
    removed: [...was.keys()].filter((name) => !is.has(name)),
    changed: [...is]
      .filter(([name, body]) => was.has(name) && was.get(name) !== body)
      .map(([name]) => name),
  };
}

/** The reasons a diff should fail a check, for `--fail-on missing,stale`. */
export function regressions(diff: CoverageDiff, failOn: string[]): string[] {
  const reasons: string[] = [];
  if (failOn.includes("missing") && diff.new_missing.length > 0) {
    reasons.push(
      `${diff.new_missing.length} new missing: ${diff.new_missing.map(label).join(", ")}`,
    );
  }
  if (failOn.includes("stale") && diff.newly_stale.length > 0) {
    reasons.push(
      `${diff.newly_stale.length} newly stale: ${diff.newly_stale.map(label).join(", ")}`,
    );
  }
  if (failOn.includes("dropped") && diff.dropped.length > 0) {
    reasons.push(`${diff.dropped.length} dropped: ${diff.dropped.map(label).join(", ")}`);
  }
  return reasons;
}

function label(item: Capability): string {
  return `${item.trigger.kind} "${item.trigger.name}" on ${item.page}`;
}

export function formatDiff(diff: CoverageDiff, ops?: OpsDiff): string[] {
  const lines: string[] = [];
  const section = (title: string, items: Capability[]): void => {
    if (items.length === 0) return;
    lines.push(`${title} (${items.length}):`);
    for (const item of items) {
      lines.push(`  ${item.id} :: ${item.reason ?? item.precondition ?? label(item)}`);
    }
  };

  section("new missing", diff.new_missing);
  section("newly stale or removed", diff.newly_stale);
  section("dropped from the ledger", diff.dropped);
  section("newly unavailable", diff.newly_unavailable);
  section("newly mapped", diff.newly_mapped);
  if (ops !== undefined) {
    if (ops.added.length > 0) lines.push(`ops added: ${ops.added.join(", ")}`);
    if (ops.removed.length > 0) lines.push(`ops removed: ${ops.removed.join(", ")}`);
    if (ops.changed.length > 0) lines.push(`ops changed: ${ops.changed.join(", ")}`);
  }
  return lines.length === 0 ? ["no change in coverage"] : lines;
}

/** A pull request comment: the headline, then what to look at. */
export function diffMarkdown(
  site: string,
  current: CapabilityLedger,
  diff: CoverageDiff,
  failures: string[],
  ops?: OpsDiff,
): string {
  const rows = (title: string, items: Capability[]): string[] =>
    items.length === 0
      ? []
      : [
          `**${title}**`,
          ...items.map(
            (item) => `- \`${item.id}\`: ${item.reason ?? item.precondition ?? label(item)}`,
          ),
          "",
        ];

  return [
    `### Portolan map coverage: \`${site}\``,
    "",
    `${failures.length > 0 ? "❌" : "✅"} ${formatCoverage(coverageOf(current))}`,
    "",
    ...failures.map((reason) => `- ❌ ${reason}`),
    ...(failures.length > 0 ? [""] : []),
    ...rows("New missing", diff.new_missing),
    ...rows("Newly stale or removed", diff.newly_stale),
    ...rows("Dropped from the ledger", diff.dropped),
    ...rows("Newly mapped", diff.newly_mapped),
    ...(ops !== undefined && ops.added.length + ops.removed.length + ops.changed.length > 0
      ? [`**Ops** +${ops.added.length} −${ops.removed.length} ~${ops.changed.length}`, ""]
      : []),
    ...(failures.length > 0
      ? [
          "Map the new control (`portolan map record --gaps`), or exclude it with a reason (`portolan map capability set --status excluded --reason ...`).",
        ]
      : []),
  ].join("\n");
}
