import { readFileSync } from "node:fs";

import { type VerifyReport, verifyOp } from "@abubakarsiddiik/compiler";
import { type OpDef, parseMap, type SiteMap } from "@abubakarsiddiik/protocol";

export type VerifyInput = {
  mapPath: string;
  /** JSON object: op name to an array of at least three param sets. */
  paramsPath: string;
  /** Verify only these ops; defaults to every op with a param set. */
  ops?: string[];
  baseUrl?: string;
  executablePath?: string;
  /** Default true. */
  headless?: boolean;
};

export type VerifyDeps = {
  verifyOp?: typeof verifyOp;
};

export type VerifyResult = {
  map: SiteMap;
  reports: VerifyReport[];
  ok: boolean;
};

/**
 * Verify a map's ops against a live site.
 *
 * Each op needs at least three param sets; a smaller set is rejected rather
 * than guessed. An op with no param set is skipped and reported, so the exit
 * code means "every op that was asked about passed", not "the map is perfect".
 */
export async function runVerify(input: VerifyInput, deps: VerifyDeps = {}): Promise<VerifyResult> {
  const map = parseMap(readFileSync(input.mapPath, "utf8"));
  const paramSets = JSON.parse(readFileSync(input.paramsPath, "utf8")) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  const wanted = input.ops ?? Object.keys(paramSets);
  const verify = deps.verifyOp ?? verifyOp;
  const reports: VerifyReport[] = [];

  for (const name of wanted) {
    const op = map.ops.find((candidate) => candidate.name === name);
    if (op === undefined) {
      throw new Error(`no op "${name}" in ${input.mapPath}`);
    }

    const sets = paramSets[name];
    if (sets === undefined || sets.length === 0) {
      reports.push({
        op: name,
        verified: false,
        impls: [],
        reason: "no param sets; add at least three to verify it",
      });
      continue;
    }

    reports.push(
      await verify({
        map,
        op: op as OpDef,
        paramSets: sets,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
      }),
    );
  }

  return {
    map,
    reports,
    ok: reports.every((report) => report.verified),
  };
}
