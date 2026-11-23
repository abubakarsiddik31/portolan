import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A per-site egress policy. Default deny: only `allow` patterns pass. */
export type EgressPolicy = {
  site: string;
  /** Host or host:port patterns. `*` and `*.example.com` are supported. */
  allow: string[];
  /** Checked before `allow`. */
  deny?: string[];
  /** What must not be mapped or run unattended, matched on label and/or request. */
  rules?: PolicyRule[];
};

/**
 * One exclusion rule. `label` is a regex on a control's accessible name;
 * `request` is `METHOD url-glob` matched on a network effect the control
 * fired. A rule needs at least one of them.
 */
export type PolicyRule = {
  /** Free text; `cost` and `destructive` also gate verification and recording. */
  category: string;
  label?: string;
  request?: string;
  reason?: string;
};

export type BlockedRequest = {
  url: string;
  method: string;
  reason: "not_allowed" | "denied" | "redirect" | "private_address";
  at: string;
};

/** Resolve a hostname to its addresses. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

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
    private readonly resolve: Resolver = defaultResolver,
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
    this.block(url, method, reason ?? (this.denied(url) ? "denied" : "not_allowed"));
  }

  /**
   * Check the allowlist, then resolve the hostname and refuse a private
   * address.
   *
   * This is a rebinding defense, not a proof: the browser resolves the name
   * again when it connects, so a name that changes between the two lookups can
   * still reach a private address. An IP literal or `localhost` is trusted
   * when it is explicitly allowlisted.
   */
  async checkResolved(url: string, method = "GET"): Promise<void> {
    this.check(url, method);

    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }

    if (isIpLiteral(host) || host === "localhost") return;

    let addresses: string[];
    try {
      addresses = await this.resolve(host);
    } catch {
      // A name that does not resolve cannot be connected to; let the browser
      // report the failure rather than turning DNS into an egress decision.
      return;
    }

    if (addresses.some(isPrivateAddress)) {
      this.block(url, method, "private_address");
    }
  }

  private block(url: string, method: string, reason: BlockedRequest["reason"]): never {
    const blocked: BlockedRequest = { url, method, reason, at: new Date().toISOString() };
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
    rules?: unknown;
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
    ...(parsed.rules !== undefined ? { rules: parseRules(site, parsed.rules) } : {}),
  };
}

function parseRules(site: string, value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) throw new Error(`policy "${site}" rules must be an array`);

  return value.map((raw, index) => {
    const rule = raw as Partial<PolicyRule> | null;
    const where = `policy "${site}" rule ${index + 1}`;
    if (typeof rule !== "object" || rule === null) throw new Error(`${where} must be an object`);
    if (typeof rule.category !== "string" || rule.category.length === 0) {
      throw new Error(`${where} needs a category`);
    }
    if (rule.label === undefined && rule.request === undefined) {
      throw new Error(`${where} needs a label or a request`);
    }
    for (const key of ["label", "request", "reason"] as const) {
      if (rule[key] !== undefined && typeof rule[key] !== "string") {
        throw new Error(`${where} ${key} must be a string`);
      }
    }
    if (rule.label !== undefined) {
      try {
        new RegExp(rule.label, "i");
      } catch {
        throw new Error(`${where} label is not a valid regular expression`);
      }
    }
    return {
      category: rule.category,
      ...(rule.label !== undefined ? { label: rule.label } : {}),
      ...(rule.request !== undefined ? { request: rule.request } : {}),
      ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
    };
  });
}

/** True when a rule's `request` pattern (method, then a URL glob) matches a request. */
export function ruleMatchesRequest(rule: PolicyRule, method: string, url: string): boolean {
  if (rule.request === undefined) return false;

  const space = rule.request.indexOf(" ");
  const wantMethod = space === -1 ? "*" : rule.request.slice(0, space).toUpperCase();
  const glob = space === -1 ? rule.request : rule.request.slice(space + 1).trim();
  if (wantMethod !== "*" && wantMethod !== method.toUpperCase()) return false;

  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(url);
}

/** True when a rule's `label` pattern matches a control's accessible name. */
export function ruleMatchesLabel(rule: PolicyRule, name: string): boolean {
  return rule.label !== undefined && new RegExp(rule.label, "i").test(name);
}

/** "category: reason", so a ledger reads without hand-written reasons. */
export function ruleReason(rule: PolicyRule): string {
  return rule.reason === undefined ? rule.category : `${rule.category}: ${rule.reason}`;
}

/** True for an IPv4 or IPv6 literal, including a bracketed IPv6 host. */
export function isIpLiteral(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":");
}

/** True for loopback, private, link-local, CGNAT, multicast, and reserved. */
export function isPrivateAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, "").toLowerCase();

  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;

  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
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
