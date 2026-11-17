import { randomUUID } from "node:crypto";

import type { Delta, Effect } from "@abubakarsiddiik/substrate";

export type FallbackEffect = "read" | "write" | "irreversible";

export type TraceLocator = {
  role: string;
  name: string;
  ordinal: number;
};

export type TraceView = {
  kind: "view";
  at: string;
  doc: number;
  v: number;
  url: string;
  state?: string;
  affordances: number;
};

export type TraceAct = {
  kind: "act";
  at: string;
  ref: string;
  do: string;
  value?: string;
  key?: string;
  locator?: TraceLocator;
  doc: number;
  v: number;
  url: string;
  before_state?: string;
  after_state?: string;
  effects: Effect[];
  delta: Delta;
};

export type TraceRead = {
  kind: "read";
  at: string;
  ref?: string;
  text: string;
};

export type TraceEntry = TraceView | TraceAct | TraceRead;

export type Trace = {
  scope_id: string;
  sid: string;
  intent: string;
  effect: FallbackEffect;
  started_at: string;
  ended_at?: string;
  entries: TraceEntry[];
};

export type FallbackScope = {
  id: string;
  sid: string;
  intent: string;
  effect: FallbackEffect;
  allowed: ["view", "act", "read"];
  expiresAt: number;
  started_at: string;
  ended_at?: string;
  trace: TraceEntry[];
  result?: unknown;
};

export type FallbackScopeInput = {
  sid: string;
  intent: string;
  effect?: FallbackEffect;
  ttlMs?: number;
  now?: () => number;
};

const ALLOWED: ["view", "act", "read"] = ["view", "act", "read"];
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * Fallback scopes.
 *
 * A scope is the permission slip for the caller's agent to finish an intent
 * with the substrate verbs. While a write scope is open, the session refuses
 * other write ops, so the agent cannot wander into a second mutation.
 */
export class FallbackScopes {
  private readonly scopes = new Map<string, FallbackScope>();

  begin(input: FallbackScopeInput): FallbackScope {
    const now = input.now ?? Date.now;
    const at = now();

    // A session has at most one active scope. Beginning a new intent
    // abandons the old one: otherwise `active` returns the oldest scope,
    // view/act/read record into a stale scope, and a write scope can
    // linger after the agent has moved on.
    const previous = this.active(input.sid, at);
    if (previous !== undefined) this.scopes.delete(previous.id);

    const scope: FallbackScope = {
      id: randomUUID(),
      sid: input.sid,
      intent: input.intent,
      effect: input.effect ?? "write",
      allowed: ALLOWED,
      expiresAt: at + (input.ttlMs ?? DEFAULT_TTL_MS),
      started_at: new Date(at).toISOString(),
      trace: [],
    };

    this.scopes.set(scope.id, scope);
    return scope;
  }

  get(id: string, now = Date.now()): FallbackScope | undefined {
    const scope = this.scopes.get(id);
    if (scope === undefined) return undefined;

    if (scope.expiresAt <= now) {
      this.scopes.delete(id);
      return undefined;
    }

    return scope;
  }

  active(sid: string, now = Date.now()): FallbackScope | undefined {
    for (const scope of this.scopes.values()) {
      if (scope.sid !== sid) continue;

      if (scope.expiresAt <= now) {
        this.scopes.delete(scope.id);
        continue;
      }

      return scope;
    }

    return undefined;
  }

  close(id: string, result?: unknown): FallbackScope | undefined {
    const scope = this.scopes.get(id);
    if (scope === undefined) return undefined;

    this.scopes.delete(id);
    if (result !== undefined) scope.result = result;
    scope.ended_at = new Date().toISOString();
    return scope;
  }

  /** Append one fallback action to a scope's trace. */
  record(id: string, entry: TraceEntry): boolean {
    const scope = this.scopes.get(id);
    if (scope === undefined) return false;

    scope.trace.push(entry);
    return true;
  }

  /** The scope that should block a write, if any. */
  blocksWrite(sid: string, now = Date.now()): FallbackScope | undefined {
    const scope = this.active(sid, now);
    return scope !== undefined && scope.effect !== "read" ? scope : undefined;
  }
}
