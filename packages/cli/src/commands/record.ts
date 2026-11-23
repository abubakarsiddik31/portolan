import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { nameFitsTemplate } from "@abubakarsiddiik/protocol";
import { type Trace, type TraceAct, TraceStore } from "@abubakarsiddiik/runtime";
import { MapStore } from "@abubakarsiddiik/server";
import {
  type Capability,
  DEFAULT_RULES,
  readCapabilities,
  writeCapabilities,
} from "@abubakarsiddiik/sources";
import {
  loadPolicy,
  type PolicyRule,
  ruleMatchesLabel,
  type Substrate,
} from "@abubakarsiddiik/substrate";

import { launchSubstrate } from "./map.js";

export type RecordGapsInput = {
  site: string;
  mapsDir: string;
  tracesDir: string;
  policiesDir?: string;
  /** Which kinds of control to record. Default: buttons. */
  kinds?: string[];
  /** Record only these capability ids. */
  only?: string[];
  /** Stop after this many. */
  max?: number;
  /** Also act on a control that looks like a write or matches a destructive or cost rule. */
  writes?: boolean;
  baseUrl?: string;
  paramsPath?: string;
  chrome?: string;
  headless?: boolean;
  storageState?: string;
};

export type RecordStatus =
  | "recorded"
  | "navigated_away"
  | "disabled"
  | "not_found"
  | "skipped"
  | "failed";

export type RecordOutcome = {
  id: string;
  status: RecordStatus;
  detail?: string;
  /** The controls the page does offer, when the trigger was not found. */
  affordances?: string[];
};

export type RecordDeps = {
  substrate?: Substrate;
  close?: () => Promise<void>;
};

/** Categories whose controls are never acted on unattended without `--writes`. */
const RISKY = new Set(["destructive", "cost", "billing", "session"]);
const WRITE_VERB =
  /\b(save|create|add|submit|send|upload|approve|retry|invite|pay|confirm|publish)\b/i;

/**
 * Record a run for every `missing` single-control capability: open its page,
 * find the control by role and accessible name, click it, and write the trace
 * with the capability id on it. A compile then covers exactly that capability.
 */
export async function runRecordGaps(
  input: RecordGapsInput,
  deps: RecordDeps = {},
): Promise<{ outcomes: RecordOutcome[]; tracesPath: string }> {
  const mapDir = join(input.mapsDir, input.site);
  const ledger = readCapabilities(mapDir);
  if (ledger === undefined) {
    throw new Error(`no capabilities.json for "${input.site}"; run \`portolan map build\` first`);
  }

  const kinds = input.kinds ?? ["button"];
  const policy =
    input.policiesDir === undefined ? undefined : loadPolicy(input.site, input.policiesDir);
  const rules: PolicyRule[] = [...DEFAULT_RULES, ...(policy?.rules ?? [])];
  const states = knownStates(mapDir, input);

  let gaps = ledger.capabilities.filter(
    (item) =>
      item.status === "missing" &&
      kinds.includes(item.trigger.kind) &&
      (input.only === undefined || input.only.includes(item.id)),
  );
  if (input.max !== undefined) gaps = gaps.slice(0, input.max);

  const origin = input.baseUrl ?? states.origin;
  if (origin === undefined) throw new Error("record needs --base-url, or a map with an origin");

  const launched =
    deps.substrate === undefined
      ? await launchSubstrate({
          site: input.site,
          ...(input.policiesDir !== undefined ? { policiesDir: input.policiesDir } : {}),
          baseUrl: origin,
          ...(input.chrome !== undefined ? { chrome: input.chrome } : {}),
          ...(input.headless !== undefined ? { headless: input.headless } : {}),
          ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
        })
      : undefined;
  const substrate = deps.substrate ?? launched?.substrate;
  if (substrate === undefined) throw new Error("no browser to record with");

  const store = new TraceStore(input.tracesDir);
  const outcomes: RecordOutcome[] = [];

  try {
    for (const gap of gaps) {
      const outcome = await recordOne(gap, {
        substrate,
        store,
        origin,
        states,
        rules,
        writes: input.writes === true,
        site: input.site,
      });
      outcomes.push(outcome);

      if (outcome.status === "disabled") {
        gap.status = "unavailable";
        gap.precondition = outcome.detail ?? "disabled when recorded";
      }
    }
  } finally {
    await launched?.close();
    await deps.close?.();
  }

  if (outcomes.some((outcome) => outcome.status === "disabled")) {
    ledger.generated_at = new Date().toISOString();
    writeCapabilities(mapDir, ledger);
  }

  return { outcomes, tracesPath: join(input.tracesDir, "traces.jsonl") };
}

type StateKnowledge = {
  origin?: string;
  urls: Map<string, string>;
  samples: Map<string, Array<Record<string, unknown>>>;
  params: Record<string, Array<Record<string, unknown>>>;
};

async function recordOne(
  gap: Capability,
  context: {
    substrate: Substrate;
    store: TraceStore;
    origin: string;
    states: StateKnowledge;
    rules: PolicyRule[];
    writes: boolean;
    site: string;
  },
): Promise<RecordOutcome> {
  const { substrate, states } = context;
  const name = gap.trigger.name;

  if (!context.writes) {
    const risky = context.rules.find(
      (rule) => RISKY.has(rule.category) && ruleMatchesLabel(rule, name),
    );
    if (risky !== undefined) {
      return { id: gap.id, status: "skipped", detail: `${risky.category} rule; pass --writes` };
    }
    if (WRITE_VERB.test(name)) {
      return { id: gap.id, status: "skipped", detail: "looks like a write; pass --writes" };
    }
  }

  const page = gap.pages?.[0] ?? gap.page;
  const url = stateUrl(page, states, context.origin);
  if (typeof url !== "string") return { id: gap.id, status: "failed", detail: url.error };

  try {
    const view = await substrate.goto(url);
    const node = view.snapshot.nodes.find(
      (candidate) =>
        candidate.role === gap.trigger.kind &&
        candidate.visible &&
        nameFitsTemplate(gap.trigger.name, candidate.name),
    );

    if (node === undefined) {
      const affordances = view.snapshot.nodes
        .filter((candidate) => candidate.visible && candidate.name.length > 0)
        .filter((candidate) => candidate.role === "button" || candidate.role === "link")
        .slice(0, 15)
        .map((candidate) => `${candidate.role} "${candidate.name}"`);
      return { id: gap.id, status: "not_found", affordances };
    }

    if (node.properties.disabled === true) {
      return { id: gap.id, status: "disabled", detail: `disabled on ${page} in this data` };
    }

    const ref = view.refs.byNode.get(node.nodeId)?.ref;
    const entry = ref === undefined ? undefined : view.refs.byRef.get(ref);
    if (ref === undefined || entry === undefined) {
      return { id: gap.id, status: "failed", detail: "the control has no ref" };
    }

    const startedAt = new Date().toISOString();
    const result = await substrate.act({ ref, do: "click" });
    if (!result.ok) {
      const message = "message" in result ? result.message : result.code;
      return {
        id: gap.id,
        status: /disabled/.test(message) ? "disabled" : "failed",
        detail: message,
      };
    }

    const text = (await substrate.read()).text.slice(0, 500);
    const act: TraceAct = {
      kind: "act",
      at: new Date().toISOString(),
      ref,
      do: "click",
      locator: { role: entry.role, name: entry.name, ordinal: entry.ordinal },
      doc: result.doc,
      v: result.v,
      url: result.url,
      effects: result.effects,
      delta: result.delta,
    };
    const trace: Trace = {
      scope_id: randomUUID(),
      sid: `record-${Date.now()}`,
      intent: `Click ${name} on ${page}`,
      effect: "read",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      capability: gap.id,
      entries: [
        {
          kind: "view",
          at: startedAt,
          doc: view.snapshot.doc,
          v: view.snapshot.v,
          url: view.snapshot.url,
          affordances: view.snapshot.nodes.length,
        },
        act,
        { kind: "read", at: new Date().toISOString(), text },
      ],
    };
    await context.store.append(trace);

    const left = new URL(result.url).pathname !== new URL(view.snapshot.url).pathname;
    return left
      ? { id: gap.id, status: "navigated_away", detail: new URL(result.url).pathname }
      : { id: gap.id, status: "recorded" };
  } catch (error) {
    return {
      id: gap.id,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function knownStates(mapDir: string, input: RecordGapsInput): StateKnowledge {
  const urls = new Map<string, string>();
  const samples = new Map<string, Array<Record<string, unknown>>>();
  let origin: string | undefined;

  const published = new MapStore(input.mapsDir).get(input.site);
  for (const state of published?.states ?? []) {
    if (state.url !== undefined) urls.set(state.id, state.url);
  }
  origin = published?.origins[0];

  const draftPath = join(mapDir, "draft.json");
  if (existsSync(draftPath)) {
    const draft = JSON.parse(readFileSync(draftPath, "utf8")) as {
      origins?: string[];
      states?: Array<{ id: string; url?: string }>;
      proposals?: Array<{
        op: { to: string[] };
        sample_params?: Array<Record<string, unknown>>;
      }>;
    };
    origin ??= draft.origins?.[0];
    for (const state of draft.states ?? []) {
      if (state.url !== undefined && !urls.has(state.id)) urls.set(state.id, state.url);
    }
    for (const proposal of draft.proposals ?? []) {
      if (proposal.sample_params === undefined) continue;
      for (const to of proposal.op.to)
        samples.set(to, [...(samples.get(to) ?? []), ...proposal.sample_params]);
    }
  }

  const params =
    input.paramsPath === undefined
      ? {}
      : (JSON.parse(readFileSync(input.paramsPath, "utf8")) as StateKnowledge["params"]);

  return { ...(origin !== undefined ? { origin } : {}), urls, samples, params };
}

/** The concrete URL of a state: its template filled from a param set seen for it. */
function stateUrl(id: string, states: StateKnowledge, origin: string): string | { error: string } {
  const template = states.urls.get(id);
  if (template === undefined) return { error: `no URL known for state "${id}"` };

  const names = [...template.matchAll(/:([a-zA-Z0-9_]+)/g)].map((match) => match[1] ?? "");
  if (names.length === 0) return new URL(template, origin).toString();

  const sets = [...(states.samples.get(id) ?? []), ...Object.values(states.params).flat()];
  const values = sets.find((set) => names.every((name) => set[name] !== undefined));
  if (values === undefined) {
    return {
      error: `state "${id}" is ${template}; give a param set with ${names.join(", ")} in --params`,
    };
  }

  const path = template.replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) =>
    encodeURIComponent(String(values[name])),
  );
  return new URL(path, origin).toString();
}
