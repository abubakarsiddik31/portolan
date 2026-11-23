import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { PlaywrightEngine, Substrate, SubstrateView } from "@abubakarsiddiik/substrate";

/** How to sign in without a person. Holds env var names, never values. */
export type AuthRecipe = {
  url: string;
  fills?: Array<{ role?: string; name: string; env: string }>;
  /** The submit button's accessible name. Default: a button that reads like one. */
  submit?: string;
  /** A module whose default export is `async (page) => void` that signs in. */
  script?: string;
};

const SUBMIT_LIKE = /^(sign ?in|log ?in|submit|continue|next)\b/i;
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox"]);

/** `textbox:Username or email=APP_USER` or `Password=APP_PASSWORD`. */
export function parseFill(spec: string): NonNullable<AuthRecipe["fills"]>[number] {
  const equals = spec.lastIndexOf("=");
  const target = equals === -1 ? "" : spec.slice(0, equals);
  const env = equals === -1 ? "" : spec.slice(equals + 1).trim();
  if (target.length === 0 || !/^[A-Z_][A-Z0-9_]*$/i.test(env)) {
    throw new Error(`--fill "${spec}" must look like "textbox:Label=ENV_VAR" or "Label=ENV_VAR"`);
  }

  const colon = target.indexOf(":");
  const role = colon === -1 ? undefined : target.slice(0, colon).trim();
  const name = (colon === -1 ? target : target.slice(colon + 1)).trim();
  return { ...(role !== undefined && role.length > 0 ? { role } : {}), name, env };
}

/** A secret from `NAME`, or from the file `NAME_FILE` points to. Never from a config file. */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const direct = env[name];
  if (direct !== undefined && direct.length > 0) return direct;

  const file = env[`${name}_FILE`];
  if (file !== undefined && file.length > 0)
    return readFileSync(file, "utf8").replace(/\r?\n$/, "");

  throw new Error(`set ${name} (or ${name}_FILE) to sign in; it is not read from config`);
}

/**
 * Sign in by replaying a recipe on a fresh page, then leave the page signed in.
 * Values come from the environment at call time and appear in no message.
 */
export async function replayRecipe(
  recipe: AuthRecipe,
  engine: PlaywrightEngine,
  substrate: Substrate,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (recipe.script !== undefined) {
    const mod = (await import(pathToFileURL(recipe.script).href)) as {
      default?: (page: unknown) => Promise<void>;
    };
    if (typeof mod.default !== "function") {
      throw new Error(`${recipe.script} must export a default async function (page) => void`);
    }
    const run = mod.default;
    await engine.navigate(recipe.url);
    await engine.withPage(async (page) => run(page));
    return;
  }

  const fills = recipe.fills ?? [];
  if (fills.length === 0) throw new Error("the recipe has no --fill and no --script");

  let view = await substrate.goto(recipe.url);
  const loginPath = new URL(view.snapshot.url).pathname;
  const used = new Set<string>();

  for (const [index, fill] of fills.entries()) {
    const value = readSecret(fill.env, env);
    const node = findField(view, fill, index, used);
    if (node === undefined) {
      throw new Error(
        `no field "${fill.name}" on ${loginPath}; the page offers: ${fieldNames(view).join(", ") || "no fields"}`,
      );
    }
    used.add(node.nodeId);

    const ref = view.refs.byNode.get(node.nodeId)?.ref;
    if (ref === undefined) throw new Error(`field "${fill.name}" has no ref`);
    const result = await substrate.act({ ref, do: "fill", value }, { settle: false });
    if (!result.ok) throw new Error(`could not fill "${fill.name}": ${result.code}`);
    view = substrate.state() ?? view;
  }

  const button = view.snapshot.nodes.find(
    (node) =>
      node.role === "button" &&
      node.visible &&
      (recipe.submit === undefined
        ? SUBMIT_LIKE.test(node.name)
        : node.name.toLowerCase() === recipe.submit.toLowerCase()),
  );
  if (button === undefined) {
    throw new Error(`no submit button${recipe.submit !== undefined ? ` "${recipe.submit}"` : ""}`);
  }
  const buttonRef = view.refs.byNode.get(button.nodeId)?.ref;
  if (buttonRef === undefined) throw new Error("the submit button has no ref");

  const submitted = await substrate.act({ ref: buttonRef, do: "click" });
  if (!submitted.ok) throw new Error(`could not submit: ${submitted.code}`);

  const after = await substrate.settle();
  // Still on the sign-in page with the fields in front of you means it did not
  // take: a label with no accessible name must not hide that.
  const fieldsLeft = after.snapshot.nodes.filter(
    (node) => node.visible && TEXT_ROLES.has(node.role),
  ).length;
  const stillThere =
    new URL(after.snapshot.url).pathname === loginPath && fieldsLeft >= fills.length;
  if (stillThere) {
    const alert = after.snapshot.nodes.find(
      (node) => node.role === "alert" && node.name.length > 0,
    );
    throw new Error(
      `sign-in did not complete; the page still shows the form${alert !== undefined ? ` (${alert.name.slice(0, 120)})` : ""}`,
    );
  }
}

function findField(
  view: SubstrateView,
  fill: { role?: string; name: string },
  index: number,
  used: Set<string>,
) {
  const fields = view.snapshot.nodes.filter(
    (node) => node.visible && !used.has(node.nodeId) && TEXT_ROLES.has(node.role),
  );
  const wanted = fill.name.toLowerCase();
  const roleOk = (role: string) => fill.role === undefined || role === fill.role;

  return (
    fields.find((node) => roleOk(node.role) && node.name.toLowerCase() === wanted) ??
    fields.find((node) => roleOk(node.role) && node.name.toLowerCase().includes(wanted)) ??
    fields.find((node) => node.properties.placeholder === fill.name) ??
    // A label with no for= has no accessible name: fall back to field order.
    fields[Math.min(index, fields.length - 1)]
  );
}

function fieldNames(view: SubstrateView): string[] {
  return view.snapshot.nodes
    .filter((node) => node.visible && TEXT_ROLES.has(node.role))
    .map((node) => (node.name.length > 0 ? `"${node.name}"` : "(unnamed)"));
}

/** The earliest `exp` of a JWT found in a saved session, as epoch milliseconds. */
export function sessionExpiry(storageState: unknown): number | undefined {
  const candidates: string[] = [];
  const state = storageState as {
    cookies?: Array<{ value?: string }>;
    origins?: Array<{ localStorage?: Array<{ value?: string }> }>;
  };
  for (const cookie of state.cookies ?? []) candidates.push(cookie.value ?? "");
  for (const origin of state.origins ?? []) {
    for (const entry of origin.localStorage ?? []) candidates.push(entry.value ?? "");
  }

  const expiries: number[] = [];
  for (const value of candidates) {
    for (const token of value.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g) ??
      []) {
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as {
          exp?: unknown;
        };
        if (typeof payload.exp === "number") expiries.push(payload.exp * 1000);
      } catch {
        // Not a JWT; keep looking.
      }
    }
  }

  return expiries.length === 0 ? undefined : Math.min(...expiries);
}

/** `expires in 12m`, or `expired 3m ago`. */
export function describeExpiry(expiresAt: number, now: number): string {
  const minutes = Math.round(Math.abs(expiresAt - now) / 60_000);
  const span = minutes >= 120 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
  return expiresAt >= now ? `expires in ${span}` : `expired ${span} ago`;
}

/** True when a verification failure looks like a lapsed session, not a broken op. */
export function looksLikeAuthFailure(message: string): boolean {
  return /\b(log ?in|sign ?in|login page|unauthori[sz]ed|401|session (expired|has expired)|expired)\b/i.test(
    message,
  );
}
