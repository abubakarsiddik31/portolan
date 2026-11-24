import { isIdLike, type OpContext } from "@abubakarsiddiik/protocol";
import type { Trace, TraceAct } from "@abubakarsiddiik/runtime";
import type { NetworkEffect } from "@abubakarsiddiik/substrate";

const MESSAGE_ROLES = new Set(["alert", "status", "alertdialog", "dialog", "heading"]);
const GENERIC_SUMMARY = /^(recorded:|compiled |click |open |submit )/i;

/**
 * What a recorded run tells an agent about the op it became.
 *
 * The compiler used to keep the clicks and drop the story: `click_save` with
 * no params gave no sign of which page, which record or what changed. A run
 * already holds that: the goal it was recorded for, the requests the site made
 * and the messages it showed. Keep them next to the steps.
 */
export function runContext(input: { trace?: Trace; actions: TraceAct[] }): OpContext {
  const context: OpContext = {};
  const intent = input.trace?.intent.trim();
  if (intent !== undefined && intent.length > 0) context.intent = clip(intent, 400);

  const first = input.actions[0];
  const page = first === undefined ? undefined : pathOf(first.url);
  if (page !== undefined) context.page = page;

  const control = [...input.actions].reverse().find((act) => act.locator?.name)?.locator?.name;
  if (control !== undefined) context.control = clip(control);

  const observed = observedOf(input.actions);
  if (observed.length > 0) context.observed = observed;

  return context;
}

/** Put what the page's structure said (where, what it acts on) before what the run saw. */
export function mergeContext(structure: OpContext | undefined, run: OpContext): OpContext {
  if (structure === undefined) return run;

  return {
    ...run,
    ...(structure.page !== undefined ? { page: structure.page } : {}),
    ...(structure.section !== undefined ? { section: structure.section } : {}),
    ...(structure.control !== undefined ? { control: structure.control } : {}),
    ...(structure.subject !== undefined ? { subject: structure.subject } : {}),
  };
}

/**
 * A summary that says something. Keeps a real one; replaces "Recorded: click
 * Save." with the goal the run was recorded for, or with where the control is.
 */
export function summaryFor(summary: string, context: OpContext): string {
  if (!GENERIC_SUMMARY.test(summary)) return summary;

  if (context.intent !== undefined) return clip(context.intent, 200);
  if (context.control === undefined) return summary;

  const where = [context.section, context.subject !== undefined ? `for ${context.subject}` : ""]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  const on = context.page !== undefined ? ` on ${context.page}` : "";
  return clip(`Click "${context.control}"${where.length > 0 ? ` in ${where}` : ""}${on}.`, 200);
}

function observedOf(actions: TraceAct[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (line: string): void => {
    if (seen.has(line) || out.length >= 8) return;
    seen.add(line);
    out.push(line);
  };

  for (const act of actions) {
    for (const effect of act.effects) {
      if (effect.kind === "network" && isApiCall(effect)) {
        add(
          `${effect.method} ${templatePath(effect.url)}${effect.status ? ` -> ${effect.status}` : ""}`,
        );
      }
      if (effect.kind === "navigation") add(`goes to ${templatePath(effect.to)}`);
    }
    for (const entry of act.delta.entries) {
      if (entry.kind === "added" && MESSAGE_ROLES.has(entry.role) && entry.name.length > 0) {
        add(`shows ${entry.role} "${clip(entry.name, 80)}"`);
      }
    }
  }

  return out;
}

function isApiCall(effect: NetworkEffect): boolean {
  if (effect.resource_type !== undefined) {
    return effect.resource_type === "XHR" || effect.resource_type === "Fetch";
  }
  return effect.mime_type?.includes("json") === true;
}

function templatePath(url: string): string {
  try {
    const parsed = new URL(url, "http://portolan.local");
    const path = parsed.pathname
      .split("/")
      .map((part) => (isIdLike(part) ? "{id}" : part))
      .join("/");
    return path;
  } catch {
    return url;
  }
}

function pathOf(url: string): string | undefined {
  const path = templatePath(url);
  return path === "" ? undefined : path;
}

function clip(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}
