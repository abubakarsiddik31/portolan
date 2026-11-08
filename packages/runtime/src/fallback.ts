import { randomUUID } from "node:crypto";

export type FallbackEffect = "read" | "write" | "irreversible";

export type FallbackScope = {
  id: string;
  sid: string;
  intent: string;
  effect: FallbackEffect;
  allowed: ["view", "act", "read"];
  expiresAt: number;
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
    const scope: FallbackScope = {
      id: randomUUID(),
      sid: input.sid,
      intent: input.intent,
      effect: input.effect ?? "write",
      allowed: ALLOWED,
      expiresAt: now() + (input.ttlMs ?? DEFAULT_TTL_MS),
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
    return scope;
  }

  /** The scope that should block a write, if any. */
  blocksWrite(sid: string, now = Date.now()): FallbackScope | undefined {
    const scope = this.active(sid, now);
    return scope !== undefined && scope.effect !== "read" ? scope : undefined;
  }
}
