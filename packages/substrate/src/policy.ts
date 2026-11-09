import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A per-site egress policy. Default deny: only `allow` patterns pass. */
export type EgressPolicy = {
  site: string;
  /** Host or host:port patterns. `*` and `*.example.com` are supported. */
  allow: string[];
  /** Checked before `allow`. */
  deny?: string[];
};

export type BlockedRequest = {
  url: string;
  method: string;
  reason: "not_allowed" | "denied" | "redirect";
  at: string;
};

export class EgressBlockedError extends Error {
  readonly code = "egress_blocked";
  readonly blocked: BlockedRequest;

  constructor(blocked: BlockedRequest) {
    super(`egress blocked: ${blocked.method} ${blocked.url} (${blocked.reason})`);
    this.name = "EgressBlockedError";
    this.blocked = blocked;
  }
}

/**
 * Enforce a site's egress allowlist.
 *
 * The guard is deliberately default-deny. A request is allowed only when it
 * matches an `allow` pattern and no `deny` pattern. Every block is recorded
 * and passed to `onBlocked`, so a caller can log it or surface it in health.
 */
export class EgressGuard {
  private readonly blocked: BlockedRequest[] = [];

  constructor(
    private readonly policy: EgressPolicy,
    private readonly onBlocked?: (event: BlockedRequest) => void,
  ) {}

  allows(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (this.policy.deny?.some((pattern) => matches(pattern, parsed))) return false;
    return this.policy.allow.some((pattern) => matches(pattern, parsed));
  }

  check(url: string, method = "GET", reason?: BlockedRequest["reason"]): void {
    if (this.allows(url)) return;

    const blocked: BlockedRequest = {
      url,
      method,
      reason: reason ?? (this.denied(url) ? "denied" : "not_allowed"),
      at: new Date().toISOString(),
    };

    this.blocked.push(blocked);
    this.onBlocked?.(blocked);
    throw new EgressBlockedError(blocked);
  }

  /** The blocks seen by this guard, in order. */
  blockedRequests(): BlockedRequest[] {
    return [...this.blocked];
  }

  private denied(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.policy.deny?.some((pattern) => matches(pattern, parsed)) === true;
    } catch {
      return false;
    }
  }
}

/**
 * Load `policies/<site>.json`. A missing file returns undefined; an invalid
 * file or a site mismatch throws.
 */
export function loadPolicy(site: string, dir = "policies"): EgressPolicy | undefined {
  let raw: string;

  try {
    raw = readFileSync(join(dir, `${site}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const parsed = JSON.parse(raw) as {
    site?: unknown;
    allow?: unknown;
    deny?: unknown;
  };

  if (parsed.site !== undefined && parsed.site !== site) {
    throw new Error(`policy for "${String(parsed.site)}" cannot be loaded as "${site}"`);
  }

  if (!Array.isArray(parsed.allow) || !parsed.allow.every((value) => typeof value === "string")) {
    throw new Error(`policy "${site}" needs an allow array of strings`);
  }

  if (
    parsed.deny !== undefined &&
    (!Array.isArray(parsed.deny) || !parsed.deny.every((value) => typeof value === "string"))
  ) {
    throw new Error(`policy "${site}" deny must be an array of strings`);
  }

  return {
    site,
    allow: parsed.allow as string[],
    ...(parsed.deny !== undefined ? { deny: parsed.deny as string[] } : {}),
  };
}

function matches(pattern: string, url: URL): boolean {
  if (pattern === "*") return true;

  const [hostPattern, portPattern] = pattern.split(":");
  if (hostPattern === undefined || hostPattern.length === 0) return false;
  if (portPattern !== undefined && portPattern !== url.port) return false;

  if (hostPattern.startsWith("*.")) {
    const base = hostPattern.slice(2);
    return url.hostname === base || url.hostname.endsWith(`.${base}`);
  }

  return url.hostname === hostPattern;
}
