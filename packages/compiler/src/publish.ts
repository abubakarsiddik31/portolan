import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";

export type CandidateOp = {
  op: OpDef;
  verified: boolean;
  /** A human approved an irreversible op. Without this it is held. */
  reviewed?: boolean;
  /** Trace or run id this candidate came from. */
  source?: string;
};

export type PublishDiff = {
  added: string[];
  changed: string[];
  unchanged: string[];
  held: string[];
  rejected: string[];
};

export type PublishResult = {
  version: number;
  path: string;
  map: SiteMap;
  diff: PublishDiff;
  reviewPath?: string;
};

export type PublishOptions = {
  /** The site directory, e.g. `maps/store`. */
  dir: string;
  map: SiteMap;
  candidates: CandidateOp[];
  /** Defaults to the current version plus one. Never reuses a version. */
  version?: number;
  now?: string;
};

/**
 * Publish a new map version.
 *
 * A verified candidate replaces an op of the same name or adds a new one. An
 * irreversible op without `reviewed: true` is held: it is written to
 * `review/v<n>.json` and does not enter the map. An unverified candidate is
 * rejected and never written.
 *
 * The new map is validated with the same loader the runtime uses before it is
 * written, so a publisher bug cannot create a map the server will reject.
 */
export async function publishMap(options: PublishOptions): Promise<PublishResult> {
  const version = options.version ?? options.map.version + 1;
  if (version <= options.map.version) {
    throw new Error(`version ${version} must be greater than ${options.map.version}`);
  }

  const now = options.now ?? new Date().toISOString();
  const ops = [...options.map.ops];
  const diff: PublishDiff = { added: [], changed: [], unchanged: [], held: [], rejected: [] };
  const held: CandidateOp[] = [];
  const sources: string[] = [];

  for (const candidate of options.candidates) {
    if (!candidate.verified) {
      diff.rejected.push(candidate.op.name);
      continue;
    }

    if (candidate.op.effect === "irreversible" && candidate.reviewed !== true) {
      diff.held.push(candidate.op.name);
      held.push(candidate);
      continue;
    }

    const index = ops.findIndex((op) => op.name === candidate.op.name);

    if (index === -1) {
      ops.push(candidate.op);
      diff.added.push(candidate.op.name);
      rememberSource(sources, candidate);
      continue;
    }

    const existing = ops[index];
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(candidate.op)) {
      diff.unchanged.push(candidate.op.name);
      rememberSource(sources, candidate);
      continue;
    }

    ops[index] = candidate.op;
    diff.changed.push(candidate.op.name);
    rememberSource(sources, candidate);
  }

  const next = parseMap(
    JSON.stringify({
      ...options.map,
      version,
      ops,
      compiled_from: [...new Set([...options.map.compiled_from, ...sources])],
      verified_at: now,
    }),
  );

  await mkdir(options.dir, { recursive: true });
  const path = join(options.dir, `v${version}.json`);
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  let reviewPath: string | undefined;

  if (held.length > 0) {
    const reviewDir = join(options.dir, "review");
    await mkdir(reviewDir, { recursive: true });
    reviewPath = join(reviewDir, `v${version}.json`);
    await writeFile(
      reviewPath,
      `${JSON.stringify(
        {
          site: options.map.site,
          version,
          created_at: now,
          ops: held.map((candidate) => ({
            op: candidate.op,
            ...(candidate.source !== undefined ? { source: candidate.source } : {}),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return {
    version,
    path,
    map: next,
    diff,
    ...(reviewPath !== undefined ? { reviewPath } : {}),
  };
}

function rememberSource(sources: string[], candidate: CandidateOp): void {
  if (candidate.source !== undefined) sources.push(candidate.source);
}
