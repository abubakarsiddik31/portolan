import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { z } from "zod";

export const LocatorSchema = z.object({
  role: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  name_re: z.string().min(1).optional(),
  ctx: z.string().min(1).optional(),
  ordinal: z.number().int().min(0).optional(),
  test_id: z.string().min(1).optional(),
  attr: z.enum(["name", "value", "text", "href"]).optional(),
  attribute: z.string().min(1).optional(),
  pattern: z.string().min(1).optional(),
});

const DoStepSchema = z.discriminatedUnion("do", [
  z.object({
    do: z.enum(["click", "check", "uncheck"]),
    target: LocatorSchema,
  }),
  z.object({
    do: z.enum(["fill", "select"]),
    target: LocatorSchema,
    value: z.string(),
  }),
  z.object({
    do: z.literal("press"),
    key: z.string().min(1),
    target: LocatorSchema.optional(),
  }),
]);

export const StepSchema = z.union([
  z.object({
    op: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    confirm: z.boolean().optional(),
  }),
  z.object({ goto: z.string().min(1) }),
  DoStepSchema,
  z.object({
    await: z.enum(["url", "text"]),
    pattern: z.string().min(1).optional(),
    contains: z.string().min(1).optional(),
    timeout_ms: z.number().int().min(1).optional(),
  }),
]);

export const CheckSchema = z.union([
  z.object({ url: z.string().min(1) }),
  z.object({ text: z.object({ contains: z.string().min(1) }) }),
  z.object({ visible: LocatorSchema }),
  z.object({ absent: LocatorSchema }),
  z.object({ value: z.object({ target: LocatorSchema, equals: z.string() }) }),
  z.object({
    map_post: z.object({
      op: z.string().min(1),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
]);

export const CaseStatusSchema = z.enum(["draft", "verified", "broken", "disabled"]);

export const QaCaseSchema = z
  .object({
    schema: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/, "case id must be path-like"),
    title: z.string().min(1).max(200),
    suite: z.string().min(1).max(100),
    effect: z.enum(["read", "write", "irreversible"]),
    status: CaseStatusSchema.default("draft"),
    tags: z.array(z.string().min(1)).default([]),
    touches: z.array(z.string().min(1)).default([]),
    routes: z.array(z.string().min(1)).default([]),
    map: z
      .union([
        z.object({
          site: z.string().min(1),
          version: z.number().int().min(1),
          op: z.string().min(1),
        }),
        // The write has no op to point at yet. Say why, so the placeholder is
        // reported instead of passing for a real link.
        z.object({ site: z.string().min(1), pending: z.string().min(1).max(300) }),
      ])
      .optional(),
    setup: z.array(StepSchema).default([]),
    steps: z.array(StepSchema).min(1),
    expect: z.array(CheckSchema).default([]),
    fixtures: z.array(z.string().min(1)).default([]),
    source: z
      .object({
        kind: z.enum(["manual", "trace", "generated"]),
        trace_id: z.string().min(1).optional(),
        commit: z.string().min(1).optional(),
      })
      .optional(),
    notes: z.string().optional(),
    verifiedAt: z.string().min(1).optional(),
    verifyRuns: z.number().int().min(1).optional(),
    verifiedSha: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effect !== "read" && value.map === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "a write case needs a map so its effects are governed",
        path: ["map"],
      });
    }
  });

export type GovernedMap = { site: string; version: number; op: string };

/** The op a case is checked against, when it names one. */
export function governedMap(spec: { map?: { site: string } }): GovernedMap | undefined {
  const map = spec.map as Partial<GovernedMap> | undefined;
  return map?.op !== undefined && map.version !== undefined
    ? { site: map.site as string, version: map.version, op: map.op }
    : undefined;
}

/** Why a write case has no op yet, when it says so. */
export function pendingMap(spec: { map?: { site: string } }): string | undefined {
  return (spec.map as { pending?: string } | undefined)?.pending;
}

export const SuiteSchema = z.object({
  schema: z.literal(1),
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  include: z.object({
    tags: z.array(z.string().min(1)).optional(),
    ids: z.array(z.string().min(1)).optional(),
    globs: z.array(z.string().min(1)).optional(),
  }),
  exclude: z
    .object({
      tags: z.array(z.string().min(1)).optional(),
      ids: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  continue_on_failure: z.boolean().default(true),
  repeat: z.number().int().min(1).optional(),
});

export type QaLocator = z.infer<typeof LocatorSchema>;
export type QaStep = z.infer<typeof StepSchema>;
export type QaCheck = z.infer<typeof CheckSchema>;
export type QaCase = z.infer<typeof QaCaseSchema>;
export type QaSuite = z.infer<typeof SuiteSchema>;
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export type LoadedCase = {
  spec: QaCase;
  path: string;
  /** Path relative to the cases directory, posix separators. */
  relativePath: string;
  /** sha256 of the file bytes. */
  sha: string;
  text: string;
};

export type LoadedSuite = {
  spec: QaSuite;
  path: string;
  sha: string;
  text: string;
};

export function caseIdFromRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.json$/i, "");
}

/** The status a case really has. A stale verified claim is a draft. */
export function effectiveStatus(spec: QaCase): CaseStatus | "quarantined" | "orphaned" {
  if (spec.status !== "verified") return spec.status;
  if (spec.verifiedSha === undefined) return "draft";
  return spec.verifiedSha === caseContentSha(spec) ? "verified" : "draft";
}

/**
 * A stable hash of the case's content, excluding the trust fields.
 *
 * `sha256(stableJson(case without status, verifiedAt, verifyRuns, verifiedSha))`
 * so a JSON key reorder does not invalidate verification and an edit does.
 */
export function caseContentSha(spec: QaCase): string {
  const copy: Record<string, unknown> = { ...spec };
  delete copy.status;
  delete copy.verifiedAt;
  delete copy.verifyRuns;
  delete copy.verifiedSha;
  return createHash("sha256")
    .update(JSON.stringify(stable(copy)))
    .digest("hex");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parseCase(input: unknown, filePath?: string): QaCase {
  const spec = QaCaseSchema.parse(input);

  if (filePath !== undefined) {
    const normalized = filePath.replace(/\\/g, "/");
    if (!normalized.endsWith(`${spec.id}.json`)) {
      throw new Error(`case id "${spec.id}" does not match its path "${filePath}"`);
    }
  }

  return spec;
}

export function parseSuite(input: unknown, filePath?: string): QaSuite {
  const spec = SuiteSchema.parse(input);

  if (filePath !== undefined) {
    const normalized = filePath.replace(/\\/g, "/");
    if (!normalized.endsWith(`${spec.name}.json`)) {
      throw new Error(`suite name "${spec.name}" does not match its path "${filePath}"`);
    }
  }

  return spec;
}

export function readCaseFile(path: string): LoadedCase {
  const text = readFileSync(path, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  const spec = parseCase(parsed, path);
  return { spec, path, relativePath: relativePathOf(path), sha: sha256(text), text };
}

export function readSuiteFile(path: string): LoadedSuite {
  const text = readFileSync(path, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  const spec = parseSuite(parsed, path);
  return { spec, path, sha: sha256(text), text };
}

export type WriteCaseOptions = {
  status?: CaseStatus;
  verifiedRuns?: number;
  now?: Date;
};

/**
 * Write a case atomically. `qa_case_write` always forces `draft`; only
 * `qa_verify` may write `verified`, and it stamps the content hash.
 */
export function writeCaseFile(path: string, input: QaCase, options: WriteCaseOptions = {}): QaCase {
  const status = options.status ?? "draft";
  const spec: QaCase = { ...input, status };

  if (status === "verified") {
    spec.verifiedAt = (options.now ?? new Date()).toISOString();
    spec.verifyRuns = options.verifiedRuns ?? spec.verifyRuns ?? 3;
    spec.verifiedSha = caseContentSha({ ...spec, verifiedSha: undefined });
  } else {
    delete spec.verifiedAt;
    delete spec.verifyRuns;
    delete spec.verifiedSha;
  }

  const body = `${JSON.stringify(QaCaseSchema.parse(spec), null, 2)}\n`;
  const tmp = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  return spec;
}

export function loadCases(dir: string): LoadedCase[] {
  if (!existsSync(dir)) return [];

  const cases = listJsonFiles(dir)
    .map((path) => readCaseFile(path))
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id));

  const seen = new Map<string, string>();
  for (const item of cases) {
    const prior = seen.get(item.spec.id);
    if (prior !== undefined) {
      throw new Error(`duplicate case id "${item.spec.id}" in ${prior} and ${item.path}`);
    }
    seen.set(item.spec.id, item.path);
  }

  return cases;
}

export function loadSuites(dir: string): LoadedSuite[] {
  if (!existsSync(dir)) return [];
  return listJsonFiles(dir)
    .map((path) => readSuiteFile(path))
    .sort((a, b) => a.spec.name.localeCompare(b.spec.name));
}

export function caseMatchesSuite(c: QaCase, suite: QaSuite): boolean {
  const include = suite.include;
  const exclude = suite.exclude;

  if (exclude?.ids?.includes(c.id) === true) return false;
  if (exclude?.tags?.some((tag) => c.tags.includes(tag)) === true) return false;

  const byId = include.ids?.includes(c.id) === true;
  const byTag =
    include.tags === undefined || include.tags.length === 0
      ? false
      : include.tags.some((tag) => c.tags.includes(tag));
  const byGlob =
    include.globs === undefined || include.globs.length === 0
      ? false
      : include.globs.some((glob) => globMatches(glob, c.id));

  if (include.ids === undefined && include.tags === undefined && include.globs === undefined) {
    return true;
  }

  return byId || byTag || byGlob;
}

function relativePathOf(path: string): string {
  return relative(process.cwd(), resolve(path)).split(sep).join("/");
}

function listJsonFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".json")) continue;
    if (entry.name.startsWith(".")) continue;
    found.push(resolve(entry.parentPath, entry.name));
  }

  return found;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) result[key] = stable(source[key]);
  return result;
}

/** A small glob matcher for `touches` and suite globs. */
export function globMatches(pattern: string, value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const source = pattern.replace(/\\/g, "/");
  let regex = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "*" && next === "*") {
      if (source[index + 2] === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += char !== undefined && /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }

  return new RegExp(`^${regex}$`).test(normalized);
}
