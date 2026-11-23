import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PolicyAllowInput = {
  site: string;
  policiesDir: string;
  /** Hosts or host:port patterns to add to `allow`. */
  hosts: string[];
};

/** Add hosts to a site policy's `allow` list, creating the file when absent. */
export function runPolicyAllow(input: PolicyAllowInput): { path: string; added: string[] } {
  if (input.hosts.length === 0) {
    throw new Error("policy allow needs at least one host, e.g. localhost:8000");
  }

  const path = join(input.policiesDir, `${input.site}.json`);
  const policy: { site: string; allow: string[]; [key: string]: unknown } = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { site: input.site, allow: [] };

  const added = input.hosts.filter((host) => !policy.allow.includes(host));
  policy.allow = [...policy.allow, ...added];

  mkdirSync(input.policiesDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  return { path, added };
}

/** The hosts egress refused during a crawl, taken from the draft's tasks. */
export function blockedHosts(messages: string[]): string[] {
  const hosts = new Set<string>();

  for (const message of messages) {
    const match = /egress blocked: \w+ (\S+) \(not_allowed\)/.exec(message);
    if (match?.[1] === undefined) continue;
    try {
      hosts.add(new URL(match[1]).host);
    } catch {
      // Not a URL; nothing to suggest.
    }
  }

  return [...hosts];
}
