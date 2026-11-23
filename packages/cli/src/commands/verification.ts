import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { OpDef } from "@abubakarsiddiik/protocol";

const FILE = "verified.json";

/** What was verified, and against which build of the app. */
export type VerificationStore = {
  /** The app build the entries were verified against. */
  fingerprint?: string;
  ops: Record<string, { hash: string; verified_at: string }>;
};

export function readVerification(dir: string): VerificationStore {
  const path = join(dir, FILE);
  if (!existsSync(path)) return { ops: {} };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VerificationStore>;
    return {
      ...(parsed.fingerprint !== undefined ? { fingerprint: parsed.fingerprint } : {}),
      ops: parsed.ops ?? {},
    };
  } catch {
    // A damaged cache only costs a re-verify.
    return { ops: {} };
  }
}

export function writeVerification(dir: string, store: VerificationStore): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** A hash of everything about an op that verification depends on. */
export function opHash(op: OpDef): string {
  const { status: _status, ...rest } = op;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

/**
 * The identity of the app build: `--app-version` when given, otherwise a hash
 * of the HTML the base URL serves, which changes when its asset names do.
 */
export async function appFingerprint(
  baseUrl: string,
  override: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  if (override !== undefined && override.length > 0) return `version:${override}`;

  try {
    const response = await fetcher(baseUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const body = await response.text();
    return `html:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
  } catch {
    return undefined;
  }
}
