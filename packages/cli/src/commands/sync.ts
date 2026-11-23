import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

import {
  type PublishResult,
  publishMap,
  type VerifyReport,
  verifyOp,
} from "@abubakarsiddiik/compiler";
import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import { MapStore } from "@abubakarsiddiik/server";
import {
  type RouteFramework,
  readCapabilities,
  routeFiles,
  routeShape,
  writeCapabilities,
} from "@abubakarsiddiik/sources";
import { BrowserHandle, findChrome, type Substrate } from "@abubakarsiddiik/substrate";

import type { SyncConfig } from "../config.js";
import { type DiffResult, runCoverageDiff } from "./diff.js";
import {
  launchSubstrate,
  type MapBuildInput,
  type MapBuildResult,
  readParams,
  runMapBuild,
  stateStartUrl,
} from "./map.js";
import { repairLocators } from "./near-match.js";
import { paramSetsFor } from "./param-sets.js";

export type SyncInput = Omit<MapBuildInput, "update" | "states"> & {
  /** A git ref: changes since it decide what to re-check. */
  since: string;
  sync?: SyncConfig;
  /** Report the states a change affects and stop. */
  dryRun?: boolean;
  failOn?: string[];
};

export type SyncDeps = {
  changedFiles?: (since: string) => string[];
  build?: (input: MapBuildInput) => Promise<MapBuildResult>;
  verify?: typeof verifyOp;
  publish?: typeof publishMap;
  /** The controls on a state's page, for repairing a locator that drifted. */
  nodesFor?: (url: string) => Promise<Array<{ role: string; name: string; visible: boolean }>>;
  diff?: (against: string) => DiffResult;
};

export type SyncResult = {
  changed: string[];
  affected: string[];
  /** Changed source files no rule attributes to a state. */
  unmapped: string[];
  built?: MapBuildResult;
  /** Ops whose locator drifted and were repaired, by name. */
  repaired: string[];
  /** Ops that no longer verify and could not be repaired, with why. */
  broken: Record<string, string>;
  published?: PublishResult;
  diff?: DiffResult;
};

/** The files that differ from a git ref, relative to the repository root. */
export function gitChangedFiles(since: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", since], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").filter((line) => line.length > 0);
}

/** `src/admin/**` as a regular expression over a repo-relative path. */
export function globToRegExp(glob: string): RegExp {
  let source = "";

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    }
  }

  return new RegExp(`^${source}$`);
}

/**
 * The states a set of changed files can affect: the ones a configured glob
 * names, and the ones whose route a changed file defines.
 */
export function affectedStates(
  changed: string[],
  states: Array<{ id: string; url?: string }>,
  config: SyncConfig | undefined,
  routes: Array<{ file: string; routes: string[] }>,
  root = process.cwd(),
): { affected: string[]; unmapped: string[] } {
  const affected = new Set<string>();
  const attributed = new Set<string>();

  for (const [glob, patterns] of Object.entries(config?.paths ?? {})) {
    const matcher = globToRegExp(glob);
    const hit = changed.filter((file) => matcher.test(file));
    if (hit.length === 0) continue;

    for (const file of hit) attributed.add(file);
    for (const pattern of patterns) {
      const state = globToRegExp(pattern);
      for (const candidate of states) if (state.test(candidate.id)) affected.add(candidate.id);
    }
  }

  for (const entry of routes) {
    const file = relative(root, entry.file).split("\\").join("/");
    if (!changed.includes(file)) continue;

    attributed.add(file);
    const shapes = new Set(entry.routes.map(routeShape));
    for (const candidate of states) {
      if (candidate.url !== undefined && shapes.has(routeShape(candidate.url))) {
        affected.add(candidate.id);
      }
    }
  }

  const src = config?.src ?? "src";
  const unmapped = changed.filter(
    (file) => file.startsWith(`${src.replace(/^\.\//, "")}/`) && !attributed.has(file),
  );
  return { affected: [...affected].sort(), unmapped };
}

/**
 * Keep a map in step with the code: re-check only the pages a change touches.
 * New controls are discovered, existing ops are verified again, and an op
 * whose locator drifted to a clearly closest control is repaired, not dropped.
 */
export async function runSync(input: SyncInput, deps: SyncDeps = {}): Promise<SyncResult> {
  const changed = (deps.changedFiles ?? gitChangedFiles)(input.since);
  const store = new MapStore(input.mapsDir);
  const map = store.get(input.site);
  if (map === undefined) {
    throw new Error(`no map for "${input.site}"; run \`portolan map build\` before syncing`);
  }

  const framework: RouteFramework | undefined = input.sync?.routesFrom;
  const routes =
    framework === undefined ? [] : routeFiles(framework, resolve(input.sync?.src ?? "src"));
  const { affected, unmapped } = affectedStates(changed, map.states, input.sync, routes);

  const result: SyncResult = { changed, affected, unmapped, repaired: [], broken: {} };
  if (affected.length === 0 || input.dryRun === true) return result;

  result.built = await (deps.build ?? runMapBuild)({
    ...input,
    update: true,
    states: affected,
  });

  const repaired = await recheckExisting(input, map, affected, deps, result);

  if (repaired.length > 0) {
    result.published = await (deps.publish ?? publishMap)({
      dir: join(input.mapsDir, input.site),
      map: new MapStore(input.mapsDir).get(input.site) ?? map,
      candidates: repaired.map((op) => ({ op, verified: true, source: "sync repair" })),
    });
  }

  if (Object.keys(result.broken).length > 0) markStale(input, result.broken);

  result.diff = (
    deps.diff ??
    ((against) =>
      runCoverageDiff({
        site: input.site,
        mapsDir: input.mapsDir,
        against,
        failOn: input.failOn ?? [],
      }))
  )(input.since);
  return result;
}

async function recheckExisting(
  input: SyncInput,
  map: SiteMap,
  affected: string[],
  deps: SyncDeps,
  result: SyncResult,
): Promise<OpDef[]> {
  const params = readParams(input.paramsPath);
  const candidates = map.ops.filter(
    (op) => op.effect === "read" && op.from.some((id) => affected.includes(id)),
  );
  if (candidates.length === 0) return [];

  const executablePath = input.chrome ?? findChrome();
  const owned =
    deps.verify === undefined && executablePath !== undefined
      ? await BrowserHandle.launch({ executablePath, headless: input.headless ?? true })
      : undefined;
  let launched: Awaited<ReturnType<typeof launchSubstrate>> | undefined;
  const repaired: OpDef[] = [];
  const baseUrl = input.baseUrl ?? map.origins[0] ?? "";

  const verify = async (op: OpDef, sets: Array<Record<string, unknown>>): Promise<VerifyReport> =>
    (deps.verify ?? verifyOp)({
      map,
      op,
      paramSets: sets,
      baseUrl,
      ...(owned !== undefined ? { browser: owned } : {}),
      ...(input.chrome !== undefined ? { executablePath: input.chrome } : {}),
      ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
      headless: input.headless ?? true,
    });

  try {
    for (const op of candidates) {
      const sets = paramSetsFor(op, undefined, params[op.name]);
      if (sets === undefined) continue;

      const report = await verify(op, sets);
      if (report.verified) continue;

      const why = [
        ...report.impls.flatMap((impl) => impl.runs.map((run) => run.message ?? "")),
        report.reason ?? "",
      ];
      const drifted = why.some((message) => /locator did not resolve/.test(message));
      const state = map.states.find((candidate) => candidate.id === op.from[0]);

      let fixed: OpDef | undefined;
      if (drifted && state !== undefined) {
        const nodes =
          deps.nodesFor !== undefined
            ? await deps.nodesFor(stateStartUrl(state.id, map, params, baseUrl))
            : await (async () => {
                launched ??= await launchSubstrate({ site: input.site, ...pick(input) });
                const view = await (launched.substrate as Substrate).goto(
                  stateStartUrl(state.id, map, params, baseUrl),
                );
                return view.snapshot.nodes;
              })();
        fixed = repairLocators(op, nodes);
      }

      if (fixed !== undefined && (await verify(fixed, sets)).verified) {
        repaired.push(fixed);
        result.repaired.push(op.name);
      } else {
        result.broken[op.name] = why.find((message) => message.length > 0) ?? "did not verify";
      }
    }
  } finally {
    await launched?.close();
    await owned?.close();
  }

  return repaired;
}

function pick(input: SyncInput) {
  return {
    ...(input.policiesDir !== undefined ? { policiesDir: input.policiesDir } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.chrome !== undefined ? { chrome: input.chrome } : {}),
    ...(input.headless !== undefined ? { headless: input.headless } : {}),
    ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
  };
}

/** An op that stopped working leaves its capabilities `stale`, not silently mapped. */
function markStale(input: SyncInput, broken: Record<string, string>): void {
  const dir = join(input.mapsDir, input.site);
  const ledger = readCapabilities(dir);
  if (ledger === undefined) return;

  const now = new Date().toISOString();
  for (const item of ledger.capabilities) {
    if (item.op === undefined || broken[item.op] === undefined) continue;
    item.status = "stale";
    item.reason = `${item.op} no longer verifies: ${broken[item.op]}`;
    item.stale_since ??= now;
  }
  ledger.generated_at = now;
  writeCapabilities(dir, ledger);
}
