import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bootstrapFromTraces,
  bootstrapMap,
  type PublishResult,
  publishMap,
  type VerifyReport,
  verifyOp,
} from "@abubakarsiddiik/compiler";
import type { SiteMap, StateDef } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import { MapStore } from "@abubakarsiddiik/server";
import {
  buildCapabilities,
  type CapabilityCoverage,
  type CapabilityLedger,
  coverageOf,
  createDraft,
  type DomDiscovery,
  discoverDom,
  formatCoverage,
  type MapDraft,
  type OpProposal,
  readCapabilities,
  uniqueName,
  upgradeVerified,
  writeCapabilities,
  writeDraft,
} from "@abubakarsiddiik/sources";
import {
  BrowserHandle,
  type EgressPolicy,
  findChrome,
  loadPolicy,
  PlaywrightEngine,
  Substrate,
} from "@abubakarsiddiik/substrate";

import { paramSetsFor } from "./param-sets.js";
import { riskOf } from "./risk.js";

export type MapBuildInput = {
  site: string;
  mapsDir: string;
  /** Entry URL for DOM discovery. */
  url?: string;
  baseUrl?: string;
  traces?: string[];
  /** Directory with trace JSONL, used when no URL is given. */
  tracesDir?: string;
  paramsPath?: string;
  maxPages?: number;
  /** Existing map is required (the `update` subcommand). */
  update?: boolean;
  /** Re-crawl and re-verify only these states (needs `update`). */
  states?: string[];
  verify: boolean;
  verifyWrites: boolean;
  publish: boolean;
  /** Command that boots the app, e.g. `npm run dev`. */
  start?: string;
  chrome?: string;
  headless?: boolean;
  policiesDir?: string;
  /** Playwright storage state for pages behind auth. */
  storageState?: string;
  /** Extra patterns for capabilities that must never be auto-run. */
  exclude?: string[];
  /** JSON object: op name to the read op that proves a recorded write. */
  outcomeChecksPath?: string;
  /** Refuse to publish while any capability is missing. */
  requireComplete?: boolean;
  /** With requireComplete, also refuse while a control is unavailable. */
  strict?: boolean;
  /** Verify ops whose recorded run fired a request a `cost` or `destructive` rule matches. */
  allowCost?: boolean;
  /** Keep a layout control seen on many pages as one capability per page. */
  noDedupe?: boolean;
};

export type MapBuildDeps = {
  substrate?: Substrate;
  closeSubstrate?: () => Promise<void>;
  verify?: typeof verifyOp;
  publish?: typeof publishMap;
  now?: string;
};

export type MapBuildResult = {
  draft: MapDraft;
  draftPath: string;
  tasksPath: string;
  discovery?: DomDiscovery;
  capabilities: CapabilityLedger;
  capabilitiesPath: string;
  coverage: CapabilityCoverage;
  reports: VerifyReport[];
  verified: string[];
  published?: PublishResult;
};

/**
 * Build or update a map from a live URL and/or recorded traces.
 *
 * Discovery is read-only. Verification is the gate: an op publishes only when
 * it passes, and a write is verified only with `verifyWrites`, because running
 * a write during verification is a real mutation.
 */
export async function runMapBuild(
  input: MapBuildInput,
  deps: MapBuildDeps = {},
): Promise<MapBuildResult> {
  const maps = new MapStore(input.mapsDir);
  const existing = maps.get(input.site);

  if (input.update === true && existing === undefined) {
    throw new Error(
      `no map for "${input.site}"; run \`portolan map build --site ${input.site} --url <url>\` first`,
    );
  }

  if (input.states !== undefined && input.states.length > 0 && input.update !== true) {
    throw new Error("--state needs `map update`: it re-checks states of an existing map");
  }

  const traces = readTraces(input);
  const onlyStates = input.states ?? [];
  if (input.url === undefined && traces.length === 0 && onlyStates.length === 0) {
    throw new Error(
      "map build needs --url for DOM discovery, or a trace file / traces directory to compile",
    );
  }

  const origin =
    input.url !== undefined
      ? new URL(input.url).origin
      : (input.baseUrl ?? existing?.origins[0] ?? originFromTraces(traces));
  if (origin === undefined) {
    throw new Error("map build needs --url (DOM discovery) or --base-url (traces)");
  }

  const baseUrl = input.baseUrl ?? origin;
  const mapDir = join(input.mapsDir, input.site);
  const previous = readCapabilities(mapDir);

  const draft = createDraft({
    site: input.site,
    origins: existing?.origins ?? [origin],
    ...(input.url !== undefined ? { url: input.url } : {}),
    baseUrl,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  for (const state of existing?.states ?? []) {
    if (!draft.states.some((candidate) => candidate.id === state.id)) {
      draft.states.push(state);
    }
  }

  const policyRules =
    input.policiesDir === undefined ? [] : (loadPolicy(input.site, input.policiesDir)?.rules ?? []);
  const reservedTargets = existing?.ops.flatMap((op) => op.to) ?? [];
  let discovery: DomDiscovery | undefined;
  let close = deps.closeSubstrate;
  // One Chrome for every verification run in this build, opened on first use.
  let verifyBrowser: BrowserHandle | undefined;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;

  try {
    if (input.start !== undefined) app = await startApp(input.start, baseUrl);

    const stateUrls = onlyStates.map((id) =>
      stateStartUrl(id, existing, readParams(input.paramsPath), origin),
    );
    const entry = input.url ?? stateUrls[0];

    if (entry !== undefined) {
      let substrate = deps.substrate;
      if (substrate === undefined) {
        const launched = await launchSubstrate(input);
        substrate = launched.substrate;
        close = launched.close;
      }

      discovery = await discoverDom({
        site: input.site,
        url: entry,
        substrate,
        ...(stateUrls.length > 0
          ? { urls: input.url === undefined ? stateUrls.slice(1) : stateUrls, follow: false }
          : {}),
        ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {}),
        reserved: { linkTargets: reservedTargets },
      });

      // A per-state update leaves everything outside those states alone.
      if (onlyStates.length > 0) {
        discovery.proposals = discovery.proposals.filter((proposal) =>
          proposal.op.from.some((id) => onlyStates.includes(id)),
        );
      }

      for (const state of discovery.states) {
        if (!draft.states.some((candidate) => candidate.id === state.id)) {
          draft.states.push(state);
        }
      }
      for (const proposal of discovery.proposals) draft.proposals.push(proposal);
      for (const task of discovery.tasks) draft.tasks.push(task);
      if (discovery.truncated !== undefined) {
        draft.build = { ...draft.build, crawl_truncated: discovery.truncated };
      }
      addSource(draft, "dom");
    }

    if (traces.length > 0) {
      const outcomeChecks =
        input.outcomeChecksPath === undefined
          ? undefined
          : (JSON.parse(readFileSync(input.outcomeChecksPath, "utf8")) as Record<string, string>);
      const boot = await bootstrapFromTraces({
        site: input.site,
        origins: [origin],
        traces,
        capture: async () => undefined,
        ...(outcomeChecks !== undefined ? { outcomeChecks } : {}),
      });

      for (const state of boot.map.states) {
        if (!draft.states.some((candidate) => candidate.id === state.id)) {
          draft.states.push(state);
        }
      }

      const used = new Set(draft.proposals.map((proposal) => proposal.op.name));

      for (const candidate of boot.candidates) {
        const name = used.has(candidate.op.name)
          ? uniqueName(candidate.op.name, used)
          : candidate.op.name;
        used.add(name);
        const risk = riskOf(candidate, policyRules);
        const op = name === candidate.op.name ? candidate.op : { ...candidate.op, name };
        if (risk !== undefined && op.effect === "read") op.effect = "write";
        if (risk?.category === "destructive" && op.impls.every((impl) => impl.tier === "ui")) {
          op.effect = "irreversible";
        }
        draft.proposals.push({
          op,
          ...(risk !== undefined ? { risk } : {}),
          source: "traces",
          provenance: candidate.source ?? "recorded trace",
          confidence: "medium",
          ...(candidate.op.effect === "write"
            ? { notes: ["A recorded write needs an outcome check before an http impl is safe."] }
            : {}),
        });
      }

      for (const trace of traces) {
        if (containsWrite(trace)) {
          draft.tasks.push({
            id: `task_${draft.tasks.length + 1}`,
            kind: "add_outcome_check",
            source: "traces",
            message: `the run "${trace.intent}" contains a write; record a read op that proves it before lifting it to http`,
          });
        }
      }

      addSource(draft, "traces");
    }

    if (existing !== undefined) {
      const seen = new Set(draft.proposals.map((proposal) => proposal.op.name));
      for (const op of existing.ops) {
        if (seen.has(op.name)) continue;
        draft.tasks.push({
          id: `task_${draft.tasks.length + 1}`,
          kind: "restore_op",
          source: "dom",
          op: op.name,
          message: `${op.name} was not seen in this discovery; it was kept as-is. Run verify or record one run to confirm it still works.`,
        });
      }
    }

    const ledgerFor = (unverified?: Map<string, string>): CapabilityLedger =>
      buildCapabilities({
        site: input.site,
        ...(discovery !== undefined ? { discovery } : {}),
        // A capability the live surface still shows stays mapped when the
        // published map already has an op for it, even if discovery reserved
        // that target and proposed nothing new this run.
        proposals: [
          ...draft.proposals,
          ...(existing?.ops ?? []).map(
            (op): OpProposal => ({
              op,
              source: "dom",
              provenance: "existing map",
              confidence: "high",
            }),
          ),
        ],
        ...(previous !== undefined ? { previous } : {}),
        ...(input.exclude !== undefined ? { exclude: input.exclude } : {}),
        ...(unverified !== undefined ? { unverified, verified: new Set(verified) } : {}),
        ...(policyRules.length > 0 ? { rules: policyRules } : {}),
        ...(input.noDedupe === true ? { dedupe: false } : {}),
      });
    let capabilities = ledgerFor();
    let coverage = coverageOf(capabilities);
    const capabilitiesPath = writeCapabilities(mapDir, capabilities);
    const written = writeDraft(mapDir, draft);

    // Without verification a draft proposal is the best evidence there is, so
    // the gate can run now. With it, only verified ops count, and the gate
    // moves after the verify loop.
    if (
      !input.verify &&
      input.requireComplete === true &&
      coverage.missing +
        coverage.stale +
        coverage.removed +
        (input.strict === true ? coverage.unavailable : 0) >
        0
    ) {
      throw new Error(
        `${formatCoverage(coverage)}; resolve the gaps in ${capabilitiesPath} or mark them excluded`,
      );
    }

    const params = readParams(input.paramsPath);
    const candidates = draft.proposals.slice();

    // Discovery is done with its browser. Verification opens its own, so
    // holding this one would keep two Chromes alive for the whole verify phase.
    await close?.();
    close = undefined;

    const reports: VerifyReport[] = [];
    const verified: string[] = [];
    const unverified = new Map<string, string>();

    if (input.verify) {
      for (const proposal of candidates) {
        const op = proposal.op;
        if (op.effect !== "read" && !input.verifyWrites) {
          const message = `${op.name} is a ${op.effect}; verify it explicitly with --verify-writes`;
          unverified.set(op.name, message);
          draft.tasks.push({
            id: `task_${draft.tasks.length + 1}`,
            kind: "confirm_effect",
            source: proposal.source,
            op: op.name,
            message,
          });
          continue;
        }

        if (proposal.risk !== undefined && input.allowCost !== true) {
          const message = `${op.name} fired a ${proposal.risk.category} request (${proposal.risk.reason}); verify it explicitly with --allow-cost`;
          unverified.set(op.name, message);
          draft.tasks.push({
            id: `task_${draft.tasks.length + 1}`,
            kind: "confirm_effect",
            source: proposal.source,
            op: op.name,
            message,
          });
          continue;
        }

        const sets = paramSetsFor(op, proposal.sample_params, params[op.name]);
        if (sets === undefined) {
          const message = `add at least three parameter sets for ${op.name} in a params file`;
          unverified.set(op.name, message);
          draft.tasks.push({
            id: `task_${draft.tasks.length + 1}`,
            kind: "add_params",
            source: proposal.source,
            op: op.name,
            message,
          });
          continue;
        }

        const setup = setupFor(draft, proposal);
        let report: VerifyReport;
        try {
          const executablePath = input.chrome ?? findChrome();
          if (
            deps.verify === undefined &&
            verifyBrowser === undefined &&
            executablePath !== undefined
          ) {
            verifyBrowser = await BrowserHandle.launch({
              executablePath,
              headless: input.headless ?? true,
            });
          }

          report = await (deps.verify ?? verifyOp)({
            map: draftMap(draft),
            op,
            paramSets: sets,
            baseUrl,
            ...(setup !== undefined ? { setup } : {}),
            ...(verifyBrowser !== undefined ? { browser: verifyBrowser } : {}),
            ...(input.chrome !== undefined ? { executablePath: input.chrome } : {}),
            ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
            headless: input.headless ?? true,
          });
        } catch (error) {
          report = {
            op: op.name,
            verified: false,
            impls: [],
            reason: `verification crashed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        reports.push(report);

        if (report.verified) {
          op.status = "verified";
          verified.push(op.name);
        } else {
          const message = `${op.name} did not verify: ${report.reason ?? "every impl failed"}`;
          unverified.set(op.name, message);
          draft.tasks.push({
            id: `task_${draft.tasks.length + 1}`,
            kind: "restore_op",
            source: proposal.source,
            op: op.name,
            message,
          });
        }
      }

      // Only verification marks an op mapped, so recount without the
      // proposals that failed or were skipped, then gate on that.
      capabilities = ledgerFor(unverified);
      coverage = coverageOf(capabilities);

      // A layout control is one op that works from every page it sits on. It
      // was verified on the page it was recorded on.
      for (const item of capabilities.capabilities) {
        if (item.pages === undefined || item.status !== "mapped") continue;
        const proposal = draft.proposals.find(
          (candidate) => candidate.op.name === item.op && verified.includes(candidate.op.name),
        );
        if (proposal !== undefined) {
          proposal.op.from = [...new Set([...proposal.op.from, ...item.pages])];
        }
      }
      writeCapabilities(mapDir, capabilities);

      if (
        input.requireComplete === true &&
        coverage.missing +
          coverage.stale +
          coverage.removed +
          (input.strict === true ? coverage.unavailable : 0) >
          0
      ) {
        upgradeVerified(draft, verified);
        writeDraft(mapDir, draft);
        throw new Error(
          `${formatCoverage(coverage)}; resolve the gaps in ${capabilitiesPath} or mark them excluded`,
        );
      }
    }

    draft.build = {
      ...draft.build,
      verify: input.verify,
      verified,
    };
    upgradeVerified(draft, verified);

    let published: PublishResult | undefined;
    if (input.publish) {
      if (!input.verify) {
        throw new Error("--publish requires --verify: an unverified map is not safe to serve");
      }
      if (verified.length === 0) {
        // Write the draft first: its tasks hold the reason each op failed.
        writeDraft(join(input.mapsDir, input.site), draft);
        const reasons = [...unverified.values()].slice(0, 10).map((reason) => `\n  ${reason}`);
        throw new Error(
          `nothing verified; the draft and tasks were written for review${reasons.join("")}`,
        );
      }

      const base = existing ?? bootstrapMap(input.site, [origin]);
      base.states = mergeStates(base.states, draft.states);
      const result = await (deps.publish ?? publishMap)({
        dir: join(input.mapsDir, input.site),
        map: base,
        candidates: verified.map((name) => {
          const proposal = draft.proposals.find((candidate) => candidate.op.name === name);
          const op = proposal?.op;
          if (op === undefined) throw new Error(`verified op "${name}" disappeared from the draft`);
          return {
            op,
            verified: true,
            ...(proposal?.provenance !== undefined ? { source: proposal.provenance } : {}),
          };
        }),
      });

      published = result;
      draft.build = { ...draft.build, published: result.version };
    }

    writeDraft(join(input.mapsDir, input.site), draft);

    return {
      draft,
      draftPath: written.draft,
      tasksPath: written.tasks,
      capabilities,
      capabilitiesPath,
      coverage,
      ...(discovery !== undefined ? { discovery } : {}),
      reports,
      verified,
      ...(published !== undefined ? { published } : {}),
    };
  } finally {
    await app?.stop();
    await verifyBrowser?.close();
    await close?.();
  }
}

function addSource(draft: MapDraft, source: MapDraft["sources"][number]): void {
  if (!draft.sources.includes(source)) draft.sources.push(source);
}

function draftMap(draft: MapDraft): SiteMap {
  return {
    site: draft.site,
    origins: draft.origins,
    version: 1,
    states: draft.states,
    ops: draft.proposals.map((proposal) => proposal.op),
    entities: draft.entities,
    compiled_from: draft.sources,
    verified_at: new Date().toISOString(),
  };
}

/**
 * The URL to re-crawl for a state: its template filled from the first param
 * set the params file holds for an op that opens it.
 */
function stateStartUrl(
  id: string,
  map: SiteMap | undefined,
  params: Record<string, Array<Record<string, unknown>>>,
  origin: string,
): string {
  const state = map?.states.find((candidate) => candidate.id === id);
  if (state === undefined) throw new Error(`no state "${id}" in the map; see its states list`);
  if (state.url === undefined) throw new Error(`state "${id}" has no URL to re-crawl`);

  const opener = map?.ops.find(
    (op) => op.to.includes(id) && op.effect === "read" && params[op.name]?.[0] !== undefined,
  );
  const values = opener === undefined ? {} : (params[opener.name]?.[0] ?? {});

  const path = state.url.replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(
        `state "${id}" is ${state.url}; add a param set with "${name}" for the op that opens it to --params`,
      );
    }
    return encodeURIComponent(String(value));
  });

  return new URL(path, origin).toString();
}

function mergeStates(existing: StateDef[], discovered: StateDef[]): StateDef[] {
  const merged = [...existing];

  for (const state of discovered) {
    if (merged.some((candidate) => candidate.id === state.id)) continue;
    merged.push(state);
  }

  return merged;
}

/**
 * An op that starts on a parameterized state (`/orgs/:id`) cannot fill the
 * placeholder from its own params, so a fresh verification session would land
 * on the base URL and fail the precondition. Open the state first with the
 * read op that leads there, using the params discovery observed for it.
 */
export function setupFor(
  draft: MapDraft,
  proposal: OpProposal,
): Array<{ op: string; params: Record<string, unknown> }> | undefined {
  const op = proposal.op;
  const state = draft.states.find((candidate) => candidate.id === op.from[0]);
  const placeholders = Array.from(
    (state?.url ?? "").matchAll(/:([a-zA-Z0-9_]+)/g),
    (match) => match[1] ?? "",
  );
  if (state === undefined || placeholders.length === 0) return undefined;

  const own = Object.keys((op.params.properties as Record<string, unknown> | undefined) ?? {});
  if (placeholders.every((name) => own.some((key) => key.endsWith(name)))) return undefined;

  for (const candidate of draft.proposals) {
    const sample = candidate.sample_params?.[0];
    if (sample === undefined || candidate.op.name === op.name) continue;
    if (candidate.op.effect !== "read" || !candidate.op.to.includes(state.id)) continue;
    if (!candidate.op.impls.some((impl) => impl.tier === "url")) continue;
    if (!placeholders.every((name) => sample[name] !== undefined)) continue;
    return [{ op: candidate.op.name, params: sample }];
  }

  return undefined;
}

function readParams(path: string | undefined): Record<string, Array<Record<string, unknown>>> {
  if (path === undefined) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, Array<Record<string, unknown>>>;
}

function readTraces(input: MapBuildInput): Trace[] {
  const paths = input.traces ?? [];
  if (paths.length > 0) return paths.map(readTrace);
  if (input.tracesDir === undefined) return [];
  return readTraceDir(input.tracesDir);
}

function readTraceDir(dir: string): Trace[] {
  const file = join(dir, "traces.jsonl");
  if (!existsSync(file)) return [];

  const lines = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    try {
      const trace = JSON.parse(line) as Partial<Trace>;
      if (!Array.isArray(trace.entries)) throw new Error("no entries array");
      return trace as Trace;
    } catch (error) {
      throw new Error(
        `${file}:${index + 1} is not a trace: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

function originFromTraces(traces: Trace[]): string | undefined {
  for (const trace of traces) {
    for (const entry of trace.entries) {
      if (entry.kind !== "act" && entry.kind !== "view") continue;
      try {
        return new URL(entry.url).origin;
      } catch {
        // A malformed URL is not a usable origin; keep looking.
      }
    }
  }

  return undefined;
}

function readTrace(path: string): Trace {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Trace>;
  if (!Array.isArray(parsed.entries)) throw new Error(`${path} is not a trace`);
  return parsed as Trace;
}

function containsWrite(trace: Trace): boolean {
  return trace.entries.some(
    (entry) =>
      entry.kind === "act" &&
      entry.effects.some(
        (effect) =>
          effect.kind === "network" &&
          effect.method !== undefined &&
          effect.method !== "GET" &&
          effect.method !== "HEAD",
      ),
  );
}

/**
 * `init` writes a default-deny policy with an empty `allow`, which would block
 * the very URL the user just asked to map. Passing `--url` is the grant, so an
 * empty allowlist falls back to that host for this run. A policy that lists
 * anything is left exactly as written.
 */
export function seedPolicy(
  policy: EgressPolicy | undefined,
  url: string | undefined,
): EgressPolicy | undefined {
  if (policy === undefined || policy.allow.length > 0 || url === undefined) return policy;
  return { ...policy, allow: [new URL(url).host] };
}

async function launchSubstrate(
  input: MapBuildInput,
): Promise<{ substrate: Substrate; close: () => Promise<void> }> {
  const executablePath = input.chrome ?? findChrome();
  if (executablePath === undefined) {
    throw new Error("DOM discovery needs Chrome; install it or set CHROME_PATH");
  }

  const engine = await PlaywrightEngine.launch({
    executablePath,
    headless: input.headless ?? true,
    ...(input.storageState !== undefined ? { storageState: input.storageState } : {}),
  });

  const policy = seedPolicy(
    input.policiesDir === undefined ? undefined : loadPolicy(input.site, input.policiesDir),
    input.url ?? input.baseUrl,
  );

  return {
    substrate: new Substrate(engine, policy !== undefined ? { policy } : {}),
    close: () => engine.close(),
  };
}

async function startApp(command: string, baseUrl: string): Promise<{ stop: () => void }> {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });

  const stop = (): void => {
    if (process.platform === "win32") child.kill();
    else if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
  };

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    stop();
    throw error;
  }

  return { stop };
}

async function waitForServer(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { method: "GET" });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`the app did not answer at ${baseUrl}: ${lastError}`);
}
