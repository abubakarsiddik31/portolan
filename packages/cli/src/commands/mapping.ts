import { dirname, join } from "node:path";

import type { MappingTools } from "@abubakarsiddiik/server";
import {
  type CapabilityCoverage,
  coverageOf,
  formatCoverage,
  readCapabilities,
  writeCapabilities,
} from "@abubakarsiddiik/sources";

import type { CliConfig } from "../config.js";
import { type MapBuildInput, runMapBuild } from "./map.js";
import { runRecordGaps } from "./record.js";
import { mapStatus } from "./status.js";

type Job =
  | { state: "running"; started_at: string }
  | { state: "done"; started_at: string; summary: Record<string, unknown> }
  | { state: "failed"; started_at: string; error: string };

export type MappingDeps = {
  build?: typeof runMapBuild;
  record?: typeof runRecordGaps;
};

/** The mapping loop as MCP tools, over the same functions the CLI runs. */
export function createMappingTools(config: CliConfig, deps: MappingDeps = {}): MappingTools {
  const build = deps.build ?? runMapBuild;
  const record = deps.record ?? runRecordGaps;
  const jobs = new Map<string, Job>();
  let counter = 0;

  const storageState = process.env.PORTOLAN_STORAGE_STATE ?? config.storageState;
  const journalDir = dirname(config.traces);

  return {
    status: (site) =>
      mapStatus({
        site,
        mapsDir: config.maps,
        tracesDir: config.traces,
        journalDir,
        ...(storageState !== undefined ? { storageState } : {}),
      }),

    gaps: async ({ site, status, offset, limit }) => {
      const ledger = readCapabilities(join(config.maps, site));
      if (ledger === undefined) throw new Error(`no capabilities.json for "${site}"`);

      const wanted = status === undefined ? ["missing", "stale", "removed"] : [status];
      const items = ledger.capabilities.filter((item) => wanted.includes(item.status));
      return {
        total: items.length,
        offset,
        items: items.slice(offset, offset + limit).map((item) => ({
          id: item.id,
          page: item.page,
          kind: item.trigger.kind,
          name: item.trigger.name,
          status: item.status,
          ...(item.reason !== undefined ? { reason: item.reason } : {}),
          ...(item.precondition !== undefined ? { precondition: item.precondition } : {}),
        })),
        ...(offset + limit < items.length ? { next_offset: offset + limit } : {}),
      };
    },

    setCapability: async ({ site, id, status, reason }) => {
      const dir = join(config.maps, site);
      const ledger = readCapabilities(dir);
      const item = ledger?.capabilities.find((candidate) => candidate.id === id);
      if (ledger === undefined || item === undefined) throw new Error(`no capability "${id}"`);

      item.status = status;
      item.source = "manual";
      if (reason !== undefined) item.reason = reason;
      ledger.generated_at = new Date().toISOString();
      writeCapabilities(dir, ledger);

      const coverage: CapabilityCoverage = coverageOf(ledger);
      return { id, status, coverage: formatCoverage(coverage) };
    },

    recordGaps: async (input) => {
      const result = await record({
        site: input.site,
        mapsDir: config.maps,
        tracesDir: config.traces,
        policiesDir: config.policies,
        ...(input.only !== undefined ? { only: input.only } : {}),
        ...(input.max !== undefined ? { max: input.max } : {}),
        ...(input.kinds !== undefined ? { kinds: input.kinds } : {}),
        ...(input.writes !== undefined ? { writes: input.writes } : {}),
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        ...(config.chrome !== undefined ? { chrome: config.chrome } : {}),
        ...(storageState !== undefined ? { storageState } : {}),
        headless: config.headless,
      });

      const counts: Record<string, number> = {};
      for (const outcome of result.outcomes)
        counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
      return {
        counts,
        outcomes: result.outcomes.filter((outcome) => outcome.status !== "recorded"),
      };
    },

    startBuild: (input) => {
      counter += 1;
      const id = `job_${counter}`;
      const startedAt = new Date().toISOString();
      jobs.set(id, { state: "running", started_at: startedAt });

      const buildInput: MapBuildInput = {
        site: input.site,
        mapsDir: config.maps,
        tracesDir: config.traces,
        journalDir,
        policiesDir: config.policies,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        update: input.update,
        verify: input.verify,
        verifyWrites: false,
        publish: input.publish,
        ...(config.chrome !== undefined ? { chrome: config.chrome } : {}),
        ...(storageState !== undefined ? { storageState } : {}),
        headless: config.headless,
      };

      void build(buildInput)
        .then((result) => {
          jobs.set(id, {
            state: "done",
            started_at: startedAt,
            summary: {
              ops: result.draft.proposals.length,
              verified: result.verified.length,
              coverage: formatCoverage(result.coverage),
              ...(result.published !== undefined ? { published: result.published.version } : {}),
              tasks: result.draft.tasks.length,
            },
          });
        })
        .catch((error: unknown) => {
          jobs.set(id, {
            state: "failed",
            started_at: startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return { job: id };
    },

    job: (id) => jobs.get(id),
  };
}
