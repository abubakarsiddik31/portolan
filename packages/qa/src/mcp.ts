import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { QaError } from "./errors.js";
import { renderJUnit, renderMarkdown } from "./report.js";
import type { CaseResult } from "./runner.js";
import type { QaService, Selection } from "./service.js";
import { parseCase } from "./spec.js";

const MAX_RESULTS = 50;

/** Environment and profile are chosen by name; the agent never sees a credential. */
const ENVIRONMENT_INPUT = {
  env: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Named environment from qa_environments (dev, qa, prod). Omit for the default base URL.",
    ),
  as: z
    .string()
    .min(1)
    .optional()
    .describe("Profile (account role) within env. Optional when the environment has one profile."),
};

function environmentOf(input: { env?: string | undefined; as?: string | undefined }) {
  return {
    ...(input.env !== undefined ? { env: input.env } : {}),
    ...(input.as !== undefined ? { as: input.as } : {}),
  };
}

export type QaMcpDeps = {
  service?: QaService;
};

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function ok(result: unknown) {
  return text(JSON.stringify({ ok: true, result }));
}

function failure(code: string, message: string, details?: Record<string, unknown>) {
  return text(
    JSON.stringify({
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    }),
  );
}

function guarded<T>(run: () => Promise<T> | T) {
  return async () => {
    try {
      return ok(await run());
    } catch (error) {
      if (error instanceof QaError) return failure(error.code, error.message, error.details);
      return failure("harness_error", error instanceof Error ? error.message : String(error));
    }
  };
}

function withoutEvents(result: CaseResult): Omit<CaseResult, "events"> {
  const copy = { ...result };
  delete copy.events;
  return copy;
}

function selectionOf(input: {
  cases?: string[] | undefined;
  suite?: string | undefined;
  tag?: string | undefined;
  changed?: boolean | undefined;
}): Selection {
  return {
    ...(input.cases !== undefined ? { ids: input.cases } : {}),
    ...(input.suite !== undefined ? { suite: input.suite } : {}),
    ...(input.tag !== undefined ? { tags: [input.tag] } : {}),
    ...(input.changed !== undefined ? { changed: input.changed } : {}),
  };
}

/**
 * The QA MCP server. It is separate from the site-map server so a coding
 * agent sees only the QA tools and pays only for them.
 */
export function createQaMcpServer(service: QaService, deps: QaMcpDeps = {}): McpServer {
  const qa = deps.service ?? service;
  const server = new McpServer({ name: "portolan-qa", version: "0.0.1" });

  server.registerTool(
    "qa_list",
    {
      description:
        "List test cases with status, suite, and tags. Capped; filter by suite, tag, or status.",
      inputSchema: {
        suite: z.string().min(1).optional(),
        tag: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
      },
    },
    async ({ suite, tag, status }) =>
      guarded(() =>
        qa.list({
          ...(suite !== undefined ? { suite } : {}),
          ...(tag !== undefined ? { tag } : {}),
          ...(status !== undefined ? { status } : {}),
        }),
      )(),
  );

  server.registerTool(
    "qa_environments",
    {
      description:
        "List the configured environments, their profiles, whether each profile has a saved session, and whether writes are allowed. Never returns a credential or a session. A missing session is fixed by a person running the login command, not by you.",
      inputSchema: {},
    },
    async () => guarded(() => qa.environments())(),
  );

  server.registerTool(
    "qa_plan",
    {
      description:
        "Choose the cases affected by the current git diff. Returns ids, the files that matched, and any cases that are not verified.",
      inputSchema: {
        changed: z.boolean().optional(),
        max: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ changed, max }) =>
      guarded(() => {
        const selected = qa.select({
          changed: changed ?? true,
          ...(max !== undefined ? { max } : {}),
        });
        return {
          cases: selected.cases.map((item) => item.id),
          unverified: selected.unverified,
          ...(selected.plan !== undefined ? { plan: selected.plan } : {}),
        };
      })(),
  );

  server.registerTool(
    "qa_run",
    {
      description:
        "Run selected cases against the local app. Returns a run id and typed per-case results. Deterministic: no model is called.",
      inputSchema: {
        cases: z.array(z.string().min(1)).optional(),
        suite: z.string().min(1).optional(),
        tag: z.string().min(1).optional(),
        changed: z.boolean().optional(),
        repeat: z.number().int().min(1).max(10).optional(),
        allow_unverified: z.boolean().optional(),
        ...ENVIRONMENT_INPUT,
      },
    },
    async (input) =>
      guarded(async () => {
        const result = await qa.run(selectionOf(input), {
          ...environmentOf(input),
          ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
          ...(input.allow_unverified !== undefined
            ? { allowUnverified: input.allow_unverified }
            : {}),
          trigger: "mcp",
        });

        return {
          run_id: result.run_id,
          summary: result.summary,
          results: result.results.slice(0, MAX_RESULTS).map(withoutEvents),
          omitted: Math.max(0, result.results.length - MAX_RESULTS),
        };
      })(),
  );

  server.registerTool(
    "qa_status",
    {
      description: "Read a run's status and summary by run id.",
      inputSchema: { run_id: z.string().min(1) },
    },
    async ({ run_id }) =>
      guarded(() => {
        const report = qa.getRun(run_id);
        if (report === undefined) throw new QaError("not_found", `no run "${run_id}"`);
        return {
          run: report.run,
          summary: report.summary,
          cases: report.cases.map((item) => ({
            case_id: item.case_id,
            status: item.status,
            attempt: item.attempt,
            fail_code: item.fail_code,
            fail_reason: item.fail_reason,
          })),
        };
      })(),
  );

  server.registerTool(
    "qa_result",
    {
      description:
        "Read one case result from a run, including expected vs actual and evidence paths.",
      inputSchema: {
        run_id: z.string().min(1),
        case_id: z.string().min(1).optional(),
      },
    },
    async ({ run_id, case_id }) =>
      guarded(() => {
        const report = qa.getRun(run_id);
        if (report === undefined) throw new QaError("not_found", `no run "${run_id}"`);

        const cases =
          case_id === undefined
            ? report.cases
            : report.cases.filter((item) => item.case_id === case_id);

        if (case_id !== undefined && cases.length === 0) {
          throw new QaError("not_found", `run "${run_id}" has no case "${case_id}"`);
        }

        return {
          cases,
          evidence: report.evidence.filter(
            (item) => case_id === undefined || item.case_id === case_id,
          ),
        };
      })(),
  );

  server.registerTool(
    "qa_case_read",
    {
      description: "Read one test case spec and its index status.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => guarded(() => qa.caseRead(id))(),
  );

  server.registerTool(
    "qa_case_write",
    {
      description:
        "Validate and write one test case. The case is always written as draft; call qa_verify to promote it.",
      inputSchema: { case: z.record(z.string(), z.unknown()) },
    },
    async ({ case: input }) =>
      guarded(() => {
        const spec = parseCase(input);
        return qa.caseWrite(spec);
      })(),
  );

  server.registerTool(
    "qa_verify",
    {
      description:
        "Replay cases on fresh sessions and promote a case to verified only when every run passes. This is the only path to verified.",
      inputSchema: {
        cases: z.array(z.string().min(1)).optional(),
        suite: z.string().min(1).optional(),
        tag: z.string().min(1).optional(),
        repeat: z.number().int().min(1).max(10).optional(),
        ...ENVIRONMENT_INPUT,
      },
    },
    async (input) =>
      guarded(() =>
        qa.verify(selectionOf(input), {
          ...environmentOf(input),
          ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
        }),
      )(),
  );

  server.registerTool(
    "qa_coverage",
    {
      description: "List routes covered by cases and the cases covering each route.",
      inputSchema: {},
    },
    async () => guarded(() => qa.coverage())(),
  );

  server.registerTool(
    "qa_report",
    {
      description: "Render a run as JSON, markdown, or JUnit XML.",
      inputSchema: {
        run_id: z.string().min(1),
        format: z.enum(["json", "md", "junit"]).optional(),
      },
    },
    async ({ run_id, format }) =>
      guarded(() => {
        const report = qa.getRun(run_id);
        if (report === undefined) throw new QaError("not_found", `no run "${run_id}"`);

        const results: CaseResult[] = report.cases.map((item) => ({
          case_id: item.case_id,
          status: item.status as CaseResult["status"],
          attempt: item.attempt,
          duration_ms: item.duration_ms ?? 0,
          ...(item.fail_code !== null
            ? { fail_code: item.fail_code as CaseResult["fail_code"] }
            : {}),
          ...(item.fail_reason !== null ? { fail_reason: item.fail_reason } : {}),
          ...(item.fail_step !== null ? { fail_step: item.fail_step } : {}),
          ...(item.evidence_dir !== null ? { evidence_dir: item.evidence_dir } : {}),
        }));

        const mode = format ?? "json";
        if (mode === "json") return report;
        if (mode === "junit") return renderJUnit({ runId: run_id, results });
        return renderMarkdown({ runId: run_id, results, summary: report.summary });
      })(),
  );

  server.registerTool(
    "qa_generate",
    {
      description:
        "Generate a draft case from an agent-authored spec (from_spec) or a recorded trace file (from_trace). Writes the case as draft; qa_verify promotes it.",
      inputSchema: {
        from_trace: z.string().min(1).optional(),
        from_spec: z.record(z.string(), z.unknown()).optional(),
        id: z.string().min(1).optional(),
        suite: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      },
    },
    async ({ from_trace, from_spec, id, suite, title }) =>
      guarded(() =>
        qa.generate(
          {
            ...(from_trace !== undefined ? { fromTracePath: from_trace } : {}),
            ...(from_spec !== undefined ? { fromSpec: from_spec } : {}),
          },
          {
            ...(id !== undefined ? { id } : {}),
            ...(suite !== undefined ? { suite } : {}),
            ...(title !== undefined ? { title } : {}),
          },
        ),
      )(),
  );

  server.registerTool(
    "qa_repair",
    {
      description:
        "Repair a case that failed on a moved or renamed target: replay to the failure, recover the locator by name similarity, rewrite the case as draft, and confirm with one run.",
      inputSchema: {
        case_id: z.string().min(1),
        from_run: z.string().min(1).optional(),
        ...ENVIRONMENT_INPUT,
      },
    },
    async ({ case_id, from_run, env, as }) =>
      guarded(() =>
        qa.repair({
          ...environmentOf({ env, as }),
          caseId: case_id,
          ...(from_run !== undefined ? { fromRun: from_run } : {}),
        }),
      )(),
  );

  return server;
}

/** Connect a QA MCP server to stdio. Used by `portolan qa mcp`. */
export async function startQaMcpServer(service: QaService): Promise<McpServer> {
  const server = createQaMcpServer(service);
  await server.connect(new StdioServerTransport());
  return server;
}
