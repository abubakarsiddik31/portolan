import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { segmentTrace } from "@abubakarsiddiik/compiler";
import type { JsonSchema, OpDef, SiteMap } from "@abubakarsiddiik/protocol";
import type { Trace } from "@abubakarsiddiik/runtime";
import { parse } from "yaml";

export type Recipe = {
  steps: string[];
  count: number;
  intent?: string;
};

export type SkillExportOptions = {
  map: SiteMap;
  /** Successful traces used to mine recipes. */
  traces?: Trace[];
  /** Notes from the repair history, rendered under Gotchas. */
  gotchas?: string[];
  /** The skills directory, e.g. `skills`. */
  outDir: string;
};

export type SkillValidation = {
  ok: boolean;
  issues: string[];
};

export type SkillExport = {
  name: string;
  dir: string;
  skillPath: string;
  referencesPath: string;
  recipes: Recipe[];
  validation: SkillValidation;
};

const MAX_SKILL_CHARS = 20_000;
const MAX_DESCRIPTION_CHARS = 1_024;

/**
 * Export a `portolan-<site>` skill from a map version.
 *
 * The skill is knowledge, not execution: it names the ops, records the recipes
 * mined from successful traces, and links the full schemas in a reference
 * file. `map_version` in the frontmatter is what lets a client notice that the
 * skill is older than the map it is calling.
 */
export async function exportSkill(options: SkillExportOptions): Promise<SkillExport> {
  const name = `portolan-${options.map.site}`;
  const dir = join(options.outDir, name);
  const referencesPath = join(dir, "references", "ops.md");
  const skillPath = join(dir, "SKILL.md");
  const recipes = mineRecipes(options.traces ?? [], options.map);
  const raw = renderSkill(options.map, recipes, options.gotchas ?? []);

  await mkdir(join(dir, "references"), { recursive: true });
  await writeFile(skillPath, raw, "utf8");
  await writeFile(referencesPath, renderReferences(options.map), "utf8");

  const validation = validateSkill(raw, {
    name,
    mapVersion: options.map.version,
    map: options.map,
  });

  if (!validation.ok) {
    throw new Error(`generated skill is invalid: ${validation.issues.join("; ")}`);
  }

  return {
    name,
    dir,
    skillPath,
    referencesPath,
    recipes,
    validation,
  };
}

/** Mine common op sequences from successful traces. */
export function mineRecipes(traces: Trace[], map: SiteMap): Recipe[] {
  const counts = new Map<string, Recipe>();

  for (const trace of traces) {
    const steps = segmentTrace(trace, map)
      .map((segment) => segment.candidate)
      .filter((step): step is string => step !== undefined);

    if (steps.length < 2) continue;

    const key = steps.join(" → ");
    const existing = counts.get(key);

    if (existing === undefined) {
      counts.set(key, {
        steps,
        count: 1,
        ...(trace.intent.length > 0 ? { intent: trace.intent } : {}),
      });
    } else {
      existing.count += 1;
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.steps.length - a.steps.length)
    .slice(0, 5);
}

/** Validate a generated SKILL.md against its map version and op list. */
export function validateSkill(
  raw: string,
  options: { name: string; mapVersion: number; map?: SiteMap },
): SkillValidation {
  const issues: string[] = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);

  if (match === null) {
    return { ok: false, issues: ["missing YAML frontmatter"] };
  }

  let frontmatter: Record<string, unknown>;

  try {
    frontmatter = (parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, issues: [`invalid frontmatter: ${String(error)}`] };
  }

  if (frontmatter.name !== options.name) {
    issues.push(`name must be "${options.name}"`);
  }

  if (typeof frontmatter.description !== "string" || frontmatter.description.length === 0) {
    issues.push("description is required");
  } else if (frontmatter.description.length > MAX_DESCRIPTION_CHARS) {
    issues.push(`description is longer than ${MAX_DESCRIPTION_CHARS} characters`);
  }

  if (frontmatter.map_version !== options.mapVersion) {
    issues.push(`map_version must be ${options.mapVersion}`);
  }

  if (raw.length > MAX_SKILL_CHARS) {
    issues.push(`skill is longer than ${MAX_SKILL_CHARS} characters`);
  }

  if (/sk-[A-Za-z0-9]{10,}/.test(raw) || /AKIA[0-9A-Z]{16}/.test(raw)) {
    issues.push("skill contains something that looks like a secret");
  }

  if (options.map !== undefined) {
    for (const op of options.map.ops) {
      if (!raw.includes(op.name)) issues.push(`op "${op.name}" is not named in the skill`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Validate a generated skill directory, including its references file. */
export async function validateSkillDir(
  dir: string,
  options: { name: string; mapVersion: number; map: SiteMap },
): Promise<SkillValidation> {
  const issues: string[] = [];
  let raw: string;

  try {
    raw = await readFile(join(dir, "SKILL.md"), "utf8");
  } catch {
    return { ok: false, issues: ["SKILL.md is missing"] };
  }

  const validation = validateSkill(raw, options);
  issues.push(...validation.issues);

  let references: string;
  try {
    references = await readFile(join(dir, "references", "ops.md"), "utf8");
  } catch {
    issues.push("references/ops.md is missing");
    return { ok: false, issues };
  }

  for (const op of options.map.ops) {
    if (!references.includes(op.name)) issues.push(`references are missing op "${op.name}"`);
  }

  return { ok: issues.length === 0, issues };
}

function renderSkill(map: SiteMap, recipes: Recipe[], gotchas: string[]): string {
  const lines: string[] = [];
  const description = describe(map);

  lines.push("---");
  lines.push(`name: portolan-${map.site}`);
  lines.push(`description: ${JSON.stringify(description)}`);
  lines.push(`map_version: ${map.version}`);
  lines.push("---");
  lines.push("");
  lines.push(`# portolan-${map.site}`);
  lines.push("");
  lines.push(
    `Generated from the Portolan map for \`${map.site}\` v${map.version}. MCP is the source of truth; this skill is knowledge, not execution.`,
  );
  lines.push("");
  lines.push("## Ops");
  lines.push("");

  for (const op of map.ops) {
    lines.push(`- \`${op.name}(${signature(op)})\` — ${op.summary} [${op.effect}]`);
  }

  lines.push("");
  lines.push("## Recipes");
  lines.push("");

  if (recipes.length === 0) {
    lines.push("No recipe has been mined from a successful trace yet.");
  } else {
    for (const recipe of recipes) {
      const label = recipe.intent ?? recipe.steps.join(" → ");
      lines.push(
        `- ${label}: ${recipe.steps.map((step) => `\`${step}\``).join(" → ")} (seen ${recipe.count}×)`,
      );
    }
  }

  if (gotchas.length > 0) {
    lines.push("");
    lines.push("## Gotchas");
    lines.push("");
    for (const gotcha of gotchas) lines.push(`- ${gotcha}`);
  }

  lines.push("");
  lines.push("## References");
  lines.push("");
  lines.push("- [Full op schemas](references/ops.md)");
  lines.push("");

  return lines.join("\n");
}

function renderReferences(map: SiteMap): string {
  const lines: string[] = [`# ${map.site} ops — map v${map.version}`, ""];

  for (const op of map.ops) {
    lines.push(`## ${op.name}`);
    lines.push("");
    lines.push(op.summary);
    lines.push("");
    lines.push(`**Effect:** ${op.effect}`);
    if (op.effect === "irreversible") lines.push("**Confirmation:** required (`confirm: true`)");
    lines.push("");
    lines.push("### Params");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(op.params, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("### Returns");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(op.returns, null, 2));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function describe(map: SiteMap): string {
  const summaries = map.ops.slice(0, 4).map((op) => op.summary.replace(/\.$/, "").toLowerCase());

  const site = map.site.charAt(0).toUpperCase() + map.site.slice(1);
  return `Use for ${site} work: ${summaries.join(", ")}. Map v${map.version}.`;
}

function signature(op: OpDef): string {
  const properties = op.params.properties;
  if (typeof properties !== "object" || properties === null) return "";
  return Object.keys(properties as Record<string, JsonSchema>).join(", ");
}
