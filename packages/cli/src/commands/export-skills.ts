import { readFileSync } from "node:fs";

import { parseMap } from "@portolan/protocol";
import type { Trace } from "@portolan/runtime";
import { exportSkill, type SkillExport } from "@portolan/skills";

export type ExportSkillsInput = {
  mapPath: string;
  outDir: string;
  /** Successful traces, used to mine recipes. */
  tracePaths?: string[];
  gotchas?: string[];
};

export type ExportSkillsDeps = {
  exportSkill?: typeof exportSkill;
};

export type ExportSkillsResult = {
  skill: SkillExport;
};

/** Export a `portolan-<site>` skill from a map, with optional recipes. */
export async function runExportSkills(
  input: ExportSkillsInput,
  deps: ExportSkillsDeps = {},
): Promise<ExportSkillsResult> {
  const map = parseMap(readFileSync(input.mapPath, "utf8"));
  const traces = (input.tracePaths ?? []).map((path) => readTrace(path));
  const exportFn = deps.exportSkill ?? exportSkill;

  const skill = await exportFn({
    map,
    outDir: input.outDir,
    ...(traces.length > 0 ? { traces } : {}),
    ...(input.gotchas !== undefined && input.gotchas.length > 0 ? { gotchas: input.gotchas } : {}),
  });

  return { skill };
}

function readTrace(path: string): Trace {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Trace>;
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${path} is not a trace: it has no entries array`);
  }
  return parsed as Trace;
}
