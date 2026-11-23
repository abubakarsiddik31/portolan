import type { Locator, PostCheck, SiteMap } from "@abubakarsiddiik/protocol";
import { templateName, templateRegex } from "@abubakarsiddiik/protocol";
import type { TraceAct } from "@abubakarsiddiik/runtime";

/** Roles whose appearance after an action is evidence the action did something. */
const SURFACES = new Set(["dialog", "alertdialog", "menu", "listbox", "alert", "status"]);

/**
 * What the recorded run proved about the page after its actions.
 *
 * A click that verifies only because the locator resolved proves nothing: a
 * filter that does nothing would pass. The trace already holds what changed,
 * so propose the checks that evidence supports:
 *
 * - the URL's path or query changed (`?range=30d`);
 * - the page moved to a state the map names;
 * - a dialog, menu or alert appeared.
 *
 * Text and network outcomes are left to the author: a phrase varies between
 * runs, and a write needs an outcome check, not a page assertion.
 */
export function inferPost(actions: TraceAct[], map: SiteMap): PostCheck[] {
  const checks: PostCheck[] = [];

  const navigations = actions.flatMap((action) =>
    action.effects.flatMap((effect) => (effect.kind === "navigation" ? [effect] : [])),
  );
  const first = navigations[0];
  const last = navigations[navigations.length - 1];

  if (first !== undefined && last !== undefined) {
    const before = parse(first.from);
    const after = parse(last.to);

    if (before !== undefined && after !== undefined) {
      const changed = [...after.searchParams].filter(
        ([key, value]) => before.searchParams.get(key) !== value,
      );

      if (before.pathname !== after.pathname || changed.length > 0) {
        checks.push({
          kind: "url",
          pattern: `^${pathRegex(after.pathname)}$`,
          ...(changed.length > 0
            ? {
                search: changed
                  .map(([key, value]) => `(^|&)${escapeRegex(key)}=${escapeRegex(value)}(&|$)`)
                  .join("|"),
              }
            : {}),
        });
      }
    }
  }

  const firstAct = actions[0];
  const lastAct = actions[actions.length - 1];
  const to = lastAct?.after_state;
  if (
    to !== undefined &&
    to !== firstAct?.before_state &&
    map.states.some((state) => state.id === to) &&
    !checks.some((check) => check.kind === "url")
  ) {
    checks.push({ kind: "state", state: to });
  }

  for (const entry of lastAct?.delta.entries ?? []) {
    if (entry.kind !== "added" || !SURFACES.has(entry.role) || entry.name.length === 0) continue;
    const templated = templateName(entry.name);
    const locator: Locator =
      templated === entry.name
        ? { role: entry.role, name: entry.name }
        : { role: entry.role, name_re: templateRegex(templated) };
    checks.push({ kind: "exists", locator });
    break;
  }

  return checks;
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url, "http://placeholder.invalid");
  } catch {
    return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A path as a regex source, with id-like segments matching any value. */
function pathRegex(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment) ? "[^/]+" : escapeRegex(segment),
    )
    .join("/");
}
