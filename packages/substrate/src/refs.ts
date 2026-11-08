import type { SemanticNode } from "./engine.js";

/**
 * A ref is a short, document-scoped handle for a node: `e` plus a base36
 * hash prefix, e.g. `e1a2b`. It is not a CSS selector and not a Playwright
 * locator. It is only meaningful within the document that produced it.
 */
export type Ref = string;

export type RefEntry = {
  ref: Ref;
  doc: number;
  nodeId: string;
  backendNodeId: number;
  role: string;
  name: string;
  /** Occurrence among nodes with the same role, name, and frame path. */
  ordinal: number;
};

export type RefMap = {
  doc: number;
  byRef: Map<Ref, RefEntry>;
  byNode: Map<string, RefEntry>;
  byBackend: Map<number, RefEntry>;
};

export type RefOptions = {
  /** Included in the hash; "main" for a single frame. */
  framePath?: string;
  /** Injectable for collision tests. */
  hash?: (input: string) => number;
};

export type RefResolution =
  | { ok: true; entry: RefEntry }
  | { ok: false; code: "stale_ref"; current_doc: number; new_ref?: Ref };

const REF_LENGTH = 4;
const MAX_REF_LENGTH = 7;

/**
 * Build the ref map for one document.
 *
 * The hash input is `role|name|framePath|ordinal`, so a ref survives a
 * re-render when the same node is still there. Collisions extend the prefix
 * by one character, in document order, until every ref in the group is
 * unique.
 */
export function buildRefMap(nodes: SemanticNode[], doc: number, options: RefOptions = {}): RefMap {
  const framePath = options.framePath ?? "main";
  const hash = options.hash ?? hashRef;
  const ordinals = new Map<string, number>();
  const candidates: Candidate[] = [];

  for (const node of nodes) {
    if (node.backendNodeId === undefined || node.ignored) continue;

    const key = `${node.role}|${node.name}|${framePath}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);

    candidates.push({
      node,
      ordinal,
      digest: hash(`${key}|${ordinal}`).toString(36).padStart(7, "0"),
    });
  }

  const byRef = new Map<Ref, RefEntry>();
  const byNode = new Map<string, RefEntry>();
  const byBackend = new Map<number, RefEntry>();

  for (const group of groupByPrefix(candidates)) {
    if (group.length === 1) {
      const candidate = group[0];
      if (candidate === undefined) continue;
      remember(
        byRef,
        byNode,
        byBackend,
        toEntry(candidate, `e${candidate.digest.slice(0, REF_LENGTH)}`, doc),
      );
      continue;
    }

    let length = REF_LENGTH + 1;
    let resolved = false;

    while (!resolved && length <= MAX_REF_LENGTH) {
      const refs = group.map((candidate) => `e${candidate.digest.slice(0, length)}`);

      if (new Set(refs).size === group.length) {
        group.forEach((candidate, index) => {
          const ref = refs[index];
          if (ref === undefined) return;
          remember(byRef, byNode, byBackend, toEntry(candidate, ref, doc));
        });
        resolved = true;
      } else {
        length += 1;
      }
    }

    if (!resolved) {
      group.forEach((candidate, index) => {
        const ref = `e${candidate.digest.slice(0, 6)}${index.toString(36)}`;
        remember(byRef, byNode, byBackend, toEntry(candidate, ref, doc));
      });
    }
  }

  return { doc, byRef, byNode, byBackend };
}

export function resolveRef(map: RefMap, ref: Ref): RefEntry | undefined {
  return map.byRef.get(ref);
}

/**
 * Find where a node went after a re-render. Exact role and name first, then a
 * normalized name match. Ambiguous matches are not guessed.
 */
export function findReplacement(previous: RefEntry, current: RefMap): Ref | undefined {
  const entries = [...current.byRef.values()];

  const exact = entries.find(
    (entry) => entry.role === previous.role && entry.name === previous.name,
  );
  if (exact !== undefined) return exact.ref;

  const normalized = normalizeName(previous.name);
  const fuzzy = entries.find(
    (entry) => entry.role === previous.role && normalizeName(entry.name) === normalized,
  );

  return fuzzy?.ref;
}

/**
 * Keeps the current and previous ref maps so a stale ref can be explained.
 *
 * The runtime owns one registry per session. A ref that is missing from the
 * current document is stale even if the same node came back with the same
 * ref in a later document; the caller's ref was resolved against an older
 * document, and acting on it without re-reading is unsafe.
 */
export class RefRegistry {
  private current: RefMap | undefined;
  private previous: RefMap | undefined;

  constructor(private readonly options: RefOptions = {}) {}

  build(nodes: SemanticNode[], doc: number): RefMap {
    this.previous = this.current;
    this.current = buildRefMap(nodes, doc, this.options);
    return this.current;
  }

  resolve(ref: Ref): RefResolution {
    if (this.current === undefined) {
      return { ok: false, code: "stale_ref", current_doc: 0 };
    }

    const entry = this.current.byRef.get(ref);
    if (entry !== undefined) return { ok: true, entry };

    const previous = this.previous?.byRef.get(ref);
    if (previous === undefined) {
      return { ok: false, code: "stale_ref", current_doc: this.current.doc };
    }

    const newRef = findReplacement(previous, this.current);

    return newRef === undefined
      ? { ok: false, code: "stale_ref", current_doc: this.current.doc }
      : {
          ok: false,
          code: "stale_ref",
          current_doc: this.current.doc,
          new_ref: newRef,
        };
  }
}

export function hashRef(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

type Candidate = {
  node: SemanticNode;
  ordinal: number;
  digest: string;
};

function groupByPrefix(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>();

  for (const candidate of candidates) {
    const prefix = candidate.digest.slice(0, REF_LENGTH);
    const group = groups.get(prefix) ?? [];
    group.push(candidate);
    groups.set(prefix, group);
  }

  return [...groups.values()];
}

function toEntry(candidate: Candidate, ref: Ref, doc: number): RefEntry {
  return {
    ref,
    doc,
    nodeId: candidate.node.nodeId,
    backendNodeId: candidate.node.backendNodeId as number,
    role: candidate.node.role,
    name: candidate.node.name,
    ordinal: candidate.ordinal,
  };
}

function remember(
  byRef: Map<Ref, RefEntry>,
  byNode: Map<string, RefEntry>,
  byBackend: Map<number, RefEntry>,
  entry: RefEntry,
): void {
  byRef.set(entry.ref, entry);
  byNode.set(entry.nodeId, entry);
  byBackend.set(entry.backendNodeId, entry);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
