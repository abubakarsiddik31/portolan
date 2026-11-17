import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { OpDef, SiteMap, StateDef } from "@abubakarsiddiik/protocol";

import type { DraftTask, MapDraft, OpProposal } from "./types.js";

export const DRAFT_FILE = "draft.json";
export const TASKS_FILE = "tasks.json";

export type CreateDraftInput = {
  site: string;
  origins: string[];
  url?: string;
  baseUrl?: string;
  now?: string;
};

export function createDraft(input: CreateDraftInput): MapDraft {
  return {
    schema: 1,
    site: input.site,
    origins: input.origins,
    created_at: input.now ?? new Date().toISOString(),
    sources: [],
    states: [],
    proposals: [],
    tasks: [],
    entities: {},
    build: {
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.baseUrl !== undefined ? { base_url: input.baseUrl } : {}),
      verify: false,
      verified: [],
    },
  };
}

export function addProposal(draft: MapDraft, proposal: OpProposal): void {
  draft.proposals.push(proposal);
  if (!draft.sources.includes(proposal.source)) draft.sources.push(proposal.source);
}

export function addTask(draft: MapDraft, task: Omit<DraftTask, "id">): void {
  draft.tasks.push({ id: `task_${draft.tasks.length + 1}`, ...task });
  if (!draft.sources.includes(task.source)) draft.sources.push(task.source);
}

export function addState(draft: MapDraft, state: StateDef): void {
  if (draft.states.some((candidate) => candidate.id === state.id)) return;
  draft.states.push(state);
}

/** Write the draft and its task list next to the map versions. */
export function writeDraft(dir: string, draft: MapDraft): { draft: string; tasks: string } {
  mkdirSync(dir, { recursive: true });
  const draftPath = join(dir, DRAFT_FILE);
  const tasksPath = join(dir, TASKS_FILE);

  writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  writeFileSync(
    tasksPath,
    `${JSON.stringify(
      {
        site: draft.site,
        created_at: draft.created_at,
        tasks: draft.tasks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { draft: draftPath, tasks: tasksPath };
}

export function readDraft(path: string): MapDraft {
  return JSON.parse(readFileSync(path, "utf8")) as MapDraft;
}

/** Build a candidate map from the draft. It is not validated until publish. */
export function candidateMap(
  draft: MapDraft,
  options: { version?: number; ops?: OpDef[]; now?: string } = {},
): SiteMap {
  return {
    site: draft.site,
    origins: draft.origins,
    version: options.version ?? 1,
    states: draft.states,
    ops: options.ops ?? draft.proposals.map((proposal) => proposal.op),
    entities: draft.entities,
    compiled_from: draft.sources,
    verified_at: options.now ?? new Date().toISOString(),
  };
}

export function upgradeVerified(draft: MapDraft, names: Iterable<string>): void {
  const verified = new Set(names);

  for (const proposal of draft.proposals) {
    if (verified.has(proposal.op.name)) proposal.op.status = "verified";
  }
}

/**
 * A slug that is valid as a map op or state id: lowercase, starts with a
 * letter, underscores between words.
 */
export function slug(value: string, fallback = "op"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length === 0) return fallback;
  return /^[a-z]/.test(normalized) ? normalized.slice(0, 64) : `op_${normalized}`.slice(0, 64);
}

export function uniqueName(name: string, used: Set<string>): string {
  let candidate = name.slice(0, 64);
  let suffix = 2;

  while (used.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${name.slice(0, 64 - tail.length)}${tail}`;
    suffix += 1;
  }

  used.add(candidate);
  return candidate;
}
