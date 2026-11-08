import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type Effect,
  type JsonSchema,
  type OpDef,
  parseMap,
  type SiteMap,
} from "@portolan/protocol";

export type OpSummary = {
  name: string;
  summary: string;
  effect: Effect;
  params: JsonSchema;
  returns: JsonSchema;
};

export type SiteSummary = {
  site: string;
  version: number;
  ops: OpSummary[];
};

/**
 * Maps on disk: `maps/<site>/v<n>.json`.
 *
 * A session pins one version, so `get` (latest) is only for listing and
 * `getVersion` is what a call resolves against. A missing file returns
 * undefined rather than throwing; the caller turns that into `map_not_found`.
 */
export class MapStore {
  constructor(private readonly directory: string) {}

  list(): SiteSummary[] {
    const sites = readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const summaries: SiteSummary[] = [];

    for (const site of sites) {
      const version = this.latestVersion(site);
      if (version === undefined) continue;

      const map = this.getVersion(site, version);
      if (map === undefined) continue;

      summaries.push({
        site,
        version: map.version,
        ops: map.ops.map((op) => ({
          name: op.name,
          summary: op.summary,
          effect: op.effect,
          params: op.params,
          returns: op.returns,
        })),
      });
    }

    return summaries;
  }

  get(site: string): SiteMap | undefined {
    const version = this.latestVersion(site);
    return version === undefined ? undefined : this.getVersion(site, version);
  }

  getVersion(site: string, version: number): SiteMap | undefined {
    try {
      return parseMap(readFileSync(join(this.directory, site, `v${version}.json`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  latestVersion(site: string): number | undefined {
    let files: string[];

    try {
      files = readdirSync(join(this.directory, site));
    } catch {
      return undefined;
    }

    const versions = files
      .map((file) => /^v(\d+)\.json$/.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));

    return versions.length === 0 ? undefined : Math.max(...versions);
  }
}

/** The compact text `open_site` returns. */
export function renderMap(map: SiteMap): string {
  const lines = [`${map.site} · map v${map.version}`];

  for (const op of map.ops) {
    lines.push(`  ${op.name}(${signature(op)})  ${op.summary}  [${op.effect}]`);
  }

  return lines.join("\n");
}

function signature(op: OpDef): string {
  const properties = op.params.properties;
  if (typeof properties !== "object" || properties === null) return "";
  return Object.keys(properties).join(", ");
}
