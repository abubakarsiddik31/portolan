import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type Effect,
  type JsonSchema,
  type OpContext,
  type OpDef,
  parseMap,
  type SiteMap,
} from "@abubakarsiddiik/protocol";

export type OpSummary = {
  name: string;
  summary: string;
  effect: Effect;
  /** Where the op is and what it does, when the map recorded it. */
  context?: OpContext;
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
const SAFE_SITE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A site name is a directory name; it may not escape the maps directory. */
function safeSite(site: string): boolean {
  return SAFE_SITE.test(site) && !site.includes("..");
}

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
          ...(op.context !== undefined ? { context: op.context } : {}),
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
    if (!safeSite(site)) return undefined;

    try {
      return parseMap(readFileSync(join(this.directory, site, `v${version}.json`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  latestVersion(site: string): number | undefined {
    if (!safeSite(site)) return undefined;

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
    const where = describeContext(op.context);
    if (where !== undefined) lines.push(`    ${where}`);
  }

  return lines.join("\n");
}

function signature(op: OpDef): string {
  const properties = op.params.properties;
  if (typeof properties !== "object" || properties === null) return "";
  return Object.keys(properties).join(", ");
}

/**
 * One line of where an op is and what it changed, for an agent choosing
 * between ops whose names are alike.
 */
export function describeContext(context: OpContext | undefined): string | undefined {
  if (context === undefined) return undefined;

  const where = [context.page, context.section].filter((part) => part !== undefined).join(" > ");
  const parts = [
    where.length > 0 ? `where: ${where}` : undefined,
    context.subject !== undefined ? `on: ${context.subject}` : undefined,
    context.observed !== undefined && context.observed.length > 0
      ? `effects: ${context.observed.join("; ")}`
      : undefined,
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? undefined : parts.join(" | ");
}
