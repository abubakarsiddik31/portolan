import type {
  Effect,
  JsonSchema,
  Locator,
  OpDef,
  StateDef,
  UiStep,
} from "@abubakarsiddiik/protocol";
import type { SemanticNode, Snapshot, Substrate } from "@abubakarsiddiik/substrate";

import { slug, uniqueName } from "./draft.js";
import type { DraftTask, OpProposal, SurfaceAction } from "./types.js";

export type DomDiscoverOptions = {
  site: string;
  url: string;
  substrate: Substrate;
  /** Pages to visit, including the start page. Default 10. */
  maxPages?: number;
  /** Candidate ops before the crawl stops. Default 100. */
  maxOps?: number;
  /** Follow only links on the start origin. Default true. */
  sameOrigin?: boolean;
  /** Names and link targets already in the map, so an update does not duplicate them. */
  reserved?: { names?: string[]; linkTargets?: string[] };
};

export type DomDiscovery = {
  origins: string[];
  states: StateDef[];
  proposals: OpProposal[];
  tasks: DraftTask[];
  /** Every interactive element seen, for the capability ledger. */
  surface: SurfaceAction[];
  visited: string[];
  /** State ids of the pages this crawl reached, so a partial crawl can tell stale from unvisited. */
  pages: string[];
};

const INPUT_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
]);

const GENERIC_SUBMITS = new Set([
  "submit",
  "save",
  "send",
  "continue",
  "next",
  "go",
  "done",
  "apply",
]);

const SUBMIT_VERBS =
  /^(log ?in|sign ?in|signin|submit|save|continue|create|search|checkout|apply|send|next|done|update|filter)[!.,]?$/i;

const DESTRUCTIVE = /\/(logout|signout|sign-out|delete|remove|destroy|revoke)(\/|$|\?)/i;

type NodeIndex = {
  byId: Map<string, SemanticNode>;
  ordinals: Map<string, number>;
};

/**
 * Discover a first map from the live DOM.
 *
 * Breadth first over same-origin links: every page becomes a URL-only state,
 * every navigation link a `url` read op, and every form a `ui` op (or a `url`
 * op when it submits with GET). Forms are never submitted here: discovery is
 * read-only, so a recorded run is still how a write gets proven.
 */
export async function discoverDom(options: DomDiscoverOptions): Promise<DomDiscovery> {
  const start = new URL(options.url);
  const maxPages = options.maxPages ?? 10;
  const maxOps = options.maxOps ?? 100;
  const sameOrigin = options.sameOrigin ?? true;

  const states = new Map<string, StateDef>();
  const proposals: OpProposal[] = [];
  const tasks: DraftTask[] = [];
  const visited: string[] = [];
  const pages = new Set<string>();
  const surface: SurfaceAction[] = [];
  const surfaceSeen = new Set<string>();
  const seenPages = new Set<string>();
  const usedNames = new Set<string>(options.reserved?.names ?? []);
  const linkTargets = new Set<string>(options.reserved?.linkTargets ?? []);
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];

  while (queue.length > 0 && visited.length < maxPages && proposals.length < maxOps) {
    const next = queue.shift();
    if (next === undefined) break;

    const key = pageKey(next.url);
    if (seenPages.has(key)) continue;
    seenPages.add(key);

    let view: Awaited<ReturnType<Substrate["goto"]>>;
    try {
      view = await options.substrate.goto(next.url);
    } catch (error) {
      tasks.push({
        id: `task_${tasks.length + 1}`,
        kind: "resolve_route",
        source: "dom",
        message: `could not open ${next.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    const snapshot = view.snapshot;
    const current = new URL(snapshot.url);
    if (sameOrigin && current.origin !== start.origin) continue;

    visited.push(snapshot.url);
    const index = indexNodes(snapshot.nodes);
    const from = stateFor(snapshot.url, states);
    pages.add(from.id);

    const recordSurface = (action: SurfaceAction): void => {
      const key =
        action.kind === "link" && action.target !== undefined
          ? `link\u0000${action.target}`
          : `${action.page}\u0000${action.kind}\u0000${action.name.toLowerCase()}`;
      if (surfaceSeen.has(key)) return;
      surfaceSeen.add(key);
      surface.push(action);
    };

    for (const node of snapshot.nodes) {
      if (proposals.length >= maxOps) break;
      if (node.role !== "link" || !node.visible || node.name.length === 0) continue;

      const href = linkHref(node);
      if (href === undefined) continue;
      if (!isFollowable(href)) continue;

      let target: URL;
      try {
        target = new URL(href, snapshot.url);
      } catch {
        continue;
      }

      if (!/^https?:$/.test(target.protocol)) continue;
      if (sameOrigin && target.origin !== start.origin) continue;
      if (DESTRUCTIVE.test(target.pathname)) {
        recordSurface({ page: from.id, kind: "link", name: node.name, href: target.pathname });
        continue;
      }
      if (pageKey(target.toString()) === pageKey(snapshot.url)) continue;

      const to = stateFor(target.toString(), states);
      recordSurface({
        page: from.id,
        kind: "link",
        name: node.name,
        target: to.id,
        href: target.pathname,
      });

      if (linkTargets.has(to.id)) {
        queue.push({ url: target.toString(), depth: next.depth + 1 });
        continue;
      }
      linkTargets.add(to.id);

      const route = routeTemplate(target);
      const name = uniqueName(`open_${to.id}`, usedNames);
      const params = propertiesFrom(route.params);
      const paramsRequired = route.required;

      proposals.push({
        op: readLinkOp({
          name,
          route: route.route,
          params,
          required: paramsRequired,
          from: from.id,
          to: to.id,
          summary: clampSummary(`Open ${node.name}.`),
        }),
        source: "dom",
        provenance: `link "${node.name}" on ${current.pathname}`,
        confidence: "high",
        trigger: { kind: "link", name: node.name, page: from.id },
        sample_params: Object.keys(route.values).length > 0 ? [route.values] : [{}],
      });

      queue.push({ url: target.toString(), depth: next.depth + 1 });
    }

    for (const form of formNodes(snapshot.nodes)) {
      if (proposals.length >= maxOps) break;

      const result = formResult({
        form,
        snapshot,
        index,
        from,
        states,
        usedNames,
        tasks,
      });

      if (result.proposal !== undefined) proposals.push(result.proposal);
      if (result.submitName !== undefined) {
        recordSurface({
          page: from.id,
          kind: "form",
          name: result.submitName,
        });
      }
      if (result.queueUrl !== undefined) {
        try {
          if (new URL(result.queueUrl).origin === start.origin) {
            queue.push({ url: result.queueUrl, depth: next.depth + 1 });
          }
        } catch {
          // A malformed action is a task, not a crawl target.
        }
      }
    }

    const forms = formNodes(snapshot.nodes);
    const insideForms = new Set<string>();
    for (const form of forms) {
      for (const child of descendantNodes(form, index)) insideForms.add(child.nodeId);
    }
    for (const node of snapshot.nodes) {
      if (node.role !== "button" || !node.visible || node.name.length === 0) continue;
      if (insideForms.has(node.nodeId)) continue;
      recordSurface({ page: from.id, kind: "button", name: node.name });
    }
  }

  return {
    origins: [start.origin],
    states: [...states.values()],
    proposals,
    tasks,
    surface,
    visited,
    pages: [...pages],
  };
}

function formResult(input: {
  form: SemanticNode;
  snapshot: Snapshot;
  index: NodeIndex;
  from: StateDef;
  states: Map<string, StateDef>;
  usedNames: Set<string>;
  tasks: DraftTask[];
}): { proposal?: OpProposal; queueUrl?: string; submitName?: string } {
  const descendants = descendantNodes(input.form, input.index);
  const controls = descendants.filter(
    (node) => node.visible && INPUT_ROLES.has(node.role) && node.role !== "listbox",
  );
  if (controls.length === 0) return {};

  const buttons = descendants.filter((node) => node.visible && node.role === "button");
  const submit =
    buttons.find((node) => SUBMIT_VERBS.test(node.name)) ??
    buttons.find((node) => node.name.length > 0) ??
    buttons[0];

  if (submit === undefined) {
    input.tasks.push({
      id: `task_${input.tasks.length + 1}`,
      kind: "add_locators",
      source: "dom",
      message: `form at ${new URL(input.snapshot.url).pathname} has no submit button; record one run with open_url to name it`,
    });
    return {};
  }

  // Only an explicit GET is a read. A form with no method is usually a
  // client-side submit (login, sign up); treating that as a read would tell an
  // agent a mutation is safe.
  const method = input.form.attributes?.["method"]?.toUpperCase();
  const isRead = method === "GET";
  const action = resolveAction(input.form.attributes?.["action"], input.snapshot.url);
  const fields = controls.map((control, position) => fieldOf(control, position, input.index));
  const names = new Set<string>();
  for (const field of fields) field.name = uniqueName(field.name, names);

  const first = fields[0];
  const base = slug(submit.name.length > 0 ? submit.name : (input.form.name ?? "submit"));
  const name = uniqueName(
    GENERIC_SUBMITS.has(base) && first !== undefined ? `${base}_${first.name}` : base,
    input.usedNames,
  );

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const steps: UiStep[] = [];
  const sample: Record<string, unknown> = {};

  for (const field of fields) {
    properties[field.name] = { type: field.type };
    if (field.type !== "boolean") required.push(field.name);

    if (field.role === "checkbox" || field.role === "radio" || field.role === "switch") {
      steps.push({ do: "check", target: field.locator });
      continue;
    }

    steps.push({
      do: field.role === "combobox" || field.role === "listbox" ? "select" : "fill",
      target: field.locator,
      value: `{${field.name}}`,
    });

    if (field.sample !== undefined) sample[field.name] = field.sample;
  }

  steps.push({ do: "click", target: locatorOf(submit, input.index) });

  const params: JsonSchema = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };

  // A GET action names the page it navigates to; a POST action is an endpoint,
  // not a state, and its redirect is only observable by running the write.
  const target =
    isRead && action !== undefined ? stateFor(action.toString(), input.states) : input.from;

  const effect: Effect = isRead ? "read" : "write";
  const impls: OpDef["impls"] = [];

  if (isRead && action !== undefined) {
    const route = routeTemplate(
      action,
      fields.map((field) => field.name),
    );
    impls.push({
      tier: "url",
      route: route.route,
      extract: { kind: "none" as const },
    });
  }

  impls.push({
    tier: "ui",
    steps,
    extract: { kind: "none" as const },
  });

  const proposal: OpProposal = {
    op: {
      name,
      version: 1,
      summary: clampSummary(`${isRead ? "Read" : "Submit"} the "${formLabel(input.form)}" form.`),
      params,
      returns: { type: "object" },
      from: [input.from.id],
      to: [target.id],
      post: [],
      effect,
      impls,
      status: "degraded",
    },
    source: "dom",
    provenance: `form "${formLabel(input.form)}" on ${new URL(input.snapshot.url).pathname}`,
    confidence: isRead ? "high" : "medium",
    trigger: {
      kind: "form",
      name: submit.name.length > 0 ? submit.name : formLabel(input.form),
      page: input.from.id,
    },
    ...(Object.keys(sample).length > 0 ? { sample_params: [sample] } : {}),
    ...(effect === "write"
      ? {
          notes: [
            "A form submit is a write. Record one run to verify it; lift it to http only with an outcome check.",
          ],
        }
      : {}),
  };

  if (required.length > 0 && Object.keys(sample).length < required.length) {
    input.tasks.push({
      id: `task_${input.tasks.length + 1}`,
      kind: "add_params",
      source: "dom",
      op: name,
      message: `add three parameter sets for ${name} (${required.join(", ")}) before verification`,
    });
  }

  return {
    proposal,
    submitName: submit.name.length > 0 ? submit.name : formLabel(input.form),
    ...(isRead && action !== undefined ? { queueUrl: action.toString() } : {}),
  };
}

function readLinkOp(input: {
  name: string;
  route: string;
  params: JsonSchema;
  required: string[];
  from: string;
  to: string;
  summary: string;
}): OpDef {
  return {
    name: input.name,
    version: 1,
    summary: input.summary,
    params: {
      ...input.params,
      required: input.required,
      additionalProperties: false,
    },
    returns: { type: "object" },
    from: [input.from],
    to: [input.to],
    post: [],
    effect: "read",
    impls: [
      {
        tier: "url",
        route: input.route,
        extract: { kind: "none" },
      },
    ],
    status: "degraded",
  };
}

function fieldOf(
  node: SemanticNode,
  position: number,
  index: NodeIndex,
): {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  role: string;
  locator: Locator;
  sample?: unknown;
} {
  const raw =
    node.attributes?.["name"] ??
    node.test_id ??
    (node.name.length > 0 ? node.name : `${node.role}_${position}`);
  const name = slug(raw, `field_${position}`);
  const type = inputType(node);
  const value = node.attributes?.["value"] ?? node.properties["value"];

  return {
    name,
    type,
    role: node.role,
    locator: locatorOf(node, index),
    ...(typeof value === "string" && value.length > 0 ? { sample: value } : {}),
  };
}

function inputType(node: SemanticNode): "string" | "number" | "integer" | "boolean" {
  const type = node.attributes?.["type"]?.toLowerCase();
  if (type === "checkbox" || type === "radio") return "boolean";
  if (type === "number" || type === "range") return "number";
  return "string";
}

function locatorOf(node: SemanticNode, index: NodeIndex): Locator {
  const ordinal = index.ordinals.get(node.nodeId) ?? 0;

  if (node.test_id !== undefined) return { test_id: node.test_id };
  return {
    role: node.role,
    ...(node.name.length > 0 ? { name: node.name } : {}),
    ordinal,
  };
}

function formNodes(nodes: SemanticNode[]): SemanticNode[] {
  return nodes.filter((node) => node.visible && (node.role === "form" || node.role === "search"));
}

function descendantNodes(node: SemanticNode, index: NodeIndex): SemanticNode[] {
  const result: SemanticNode[] = [];
  const queue = [...node.childIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    const child = index.byId.get(id);
    if (child === undefined) continue;
    result.push(child);
    queue.push(...child.childIds);
  }

  return result;
}

function indexNodes(nodes: SemanticNode[]): NodeIndex {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const ordinals = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const node of nodes) {
    if (!node.visible) continue;
    const key = `${node.role}\u0000${node.name}`;
    const ordinal = seen.get(key) ?? 0;
    ordinals.set(node.nodeId, ordinal);
    seen.set(key, ordinal + 1);
  }

  return { byId, ordinals };
}

function stateFor(url: string, states: Map<string, StateDef>): StateDef {
  const parsed = new URL(url);
  const pattern = pathPattern(parsed.pathname);

  for (const state of states.values()) {
    if (state.url === pattern) return state;
  }

  const base = stateId(pattern);
  let id = base;
  let suffix = 2;
  while (states.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }

  const state: StateDef = { id, url: pattern, marks: [] };
  states.set(id, state);
  return state;
}

function stateId(pattern: string): string {
  const parts = pattern.split("/").filter((part) => part.length > 0 && !part.startsWith(":"));
  const id = parts
    .map((part) => slug(part, ""))
    .filter((part) => part.length > 0)
    .join("_");
  return id.length > 0 ? id : "home";
}

function pathPattern(pathname: string): string {
  const segments = pathname.split("/").filter((part) => part.length > 0);
  let idCount = 0;

  const rendered = segments.map((segment) => {
    if (!isIdLike(segment)) return segment;
    idCount += 1;
    return idCount === 1 ? ":id" : `:id_${idCount}`;
  });

  return rendered.length === 0 ? "/" : `/${rendered.join("/")}`;
}

function routeTemplate(
  url: URL,
  extraQueryNames: string[] = [],
): {
  route: string;
  params: Record<string, JsonSchema>;
  required: string[];
  values: Record<string, unknown>;
} {
  const params: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const values: Record<string, unknown> = {};
  let idCount = 0;

  const segments = url.pathname.split("/").filter((part) => part.length > 0);
  const path =
    segments.length === 0
      ? "/"
      : `/${segments
          .map((segment) => {
            if (!isIdLike(segment)) return segment;
            idCount += 1;
            const name = idCount === 1 ? "id" : `id_${idCount}`;
            params[name] = { type: "string" };
            required.push(name);
            values[name] = segment;
            return `{${name}}`;
          })
          .join("/")}`;

  const query = new URLSearchParams(url.search);
  for (const [key, value] of query) {
    const name = slug(key, "query");
    if (params[name] !== undefined) continue;
    params[name] = { type: "string" };
    required.push(name);
    values[name] = value;
    query.set(key, `{${name}}`);
  }

  for (const name of extraQueryNames) {
    if (params[name] !== undefined) continue;
    params[name] = { type: "string" };
    required.push(name);
    query.append(name, `{${name}}`);
  }

  const search = [...query]
    .map(([key, value]) => `${key}=${value.startsWith("{") ? value : encodeURIComponent(value)}`)
    .join("&");

  return {
    route: `${path}${search.length > 0 ? `?${search}` : ""}`,
    params,
    required,
    values,
  };
}

function propertiesFrom(params: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", properties: params };
}

function isIdLike(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{8,}$/i.test(segment) ||
    (/[0-9]/.test(segment) && segment.length >= 12)
  );
}

function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

function linkHref(node: SemanticNode): string | undefined {
  const href = node.attributes?.["href"] ?? node.properties["url"] ?? node.properties["href"];
  return typeof href === "string" && href.length > 0 ? href : undefined;
}

/**
 * A link we can crawl or map.
 *
 * Bare domains (`linkedin.com/in/ada`) are relative paths to the browser, so
 * they would otherwise become a fake route under the current page. External
 * origins are still skipped later; this only removes links that are not a web
 * page at all.
 */
function isFollowable(href: string): boolean {
  const value = href.trim();
  if (value.length === 0) return false;
  if (value.startsWith("#")) return false;
  if (/^(mailto|tel|javascript|data):/i.test(value)) return false;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#]|$)/i.test(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|svg|webp|mp4|mp3)([?#]|$)/i.test(value)) {
    return false;
  }
  return true;
}

function resolveAction(action: string | undefined, base: string): URL | undefined {
  if (action === undefined || action.length === 0) return undefined;
  try {
    return new URL(action, base);
  } catch {
    return undefined;
  }
}

function clampSummary(text: string): string {
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`;
}

function formLabel(form: SemanticNode): string {
  if (form.name.length > 0) return form.name;
  const label =
    form.attributes?.["aria-label"] ?? form.attributes?.["name"] ?? form.attributes?.["id"];
  return label !== undefined && label.length > 0 ? label : "unnamed";
}
