import { randomUUID } from "node:crypto";

import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type ErrorCode,
  type OpDef,
  type ProtocolError,
  type SiteMap,
  toolName,
  validateJsonSchema,
} from "@portolan/protocol";
import {
  MemoryWriteLedger,
  runWrite,
  type WriteExecution,
  type WriteFailureCode,
  type WriteLedger,
} from "@portolan/runtime";
import { z } from "zod";

import { notReadyExecutor, type OpAudit, type OpExecutor } from "./executor.js";
import { type MapStore, renderMap } from "./maps.js";
import type { SessionStore } from "./store.js";

export type McpDeps = {
  maps: MapStore;
  sessions: SessionStore;
  /** Defaults to the honest "not implemented" executor. */
  executor?: OpExecutor;
  /** Maximum number of native tools listed for the open site. Default 30. */
  toolBudget?: number;
  /** Idempotency ledger. Defaults to an in-memory ledger per server. */
  ledger?: WriteLedger;
};

export type CallInput = {
  op: string;
  params?: Record<string, unknown>;
  idempotency_key?: string;
  confirm?: boolean;
};

/**
 * The portable MCP surface: `list_sites`, `open_site`, `call`.
 *
 * `open_site` also lists the site's ops as native tools when the client
 * supports dynamic tools. Native tools are a convenience: `call` still reaches
 * every op, including ones past the tool budget.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "portolan", version: "0.0.1" });
  const executor = deps.executor ?? notReadyExecutor;
  const ledger = deps.ledger ?? new MemoryWriteLedger();
  const budget = deps.toolBudget ?? 30;
  let currentSid: string | undefined;
  let nativeTools: RegisteredTool[] = [];

  async function callOp(input: CallInput) {
    if (currentSid === undefined) {
      return failure("session_not_found", "call open_site first");
    }

    const session = deps.sessions.get(currentSid);
    if (session === undefined || session.closed_at !== undefined) {
      currentSid = undefined;
      return failure("session_not_found", "the open session is closed");
    }

    const site = session.site;
    const version = session.map_version;
    if (site === undefined || version === undefined) {
      return failure("internal", "the session is not pinned to a map");
    }

    const map = deps.maps.getVersion(site, version);
    if (map === undefined) {
      return failure("map_not_found", `no map for ${site} v${version}`);
    }

    const opDef = map.ops.find((candidate) => candidate.name === input.op);
    if (opDef === undefined) {
      return failure("unknown_op", `no op "${input.op}" in ${site} v${version}`);
    }

    const params = input.params ?? {};
    const validation = validateJsonSchema(opDef.params, params);
    if (!validation.ok) {
      return failure("invalid_params", `params for "${input.op}" are invalid`, {
        issues: validation.issues,
      });
    }

    deps.sessions.touch(session.sid);

    let auditInfo: OpAudit | undefined;

    const runExecutor = (
      target: OpDef,
      targetParams: Record<string, unknown>,
      confirm: boolean | undefined,
      idempotencyKey: string | undefined,
    ) =>
      executor({
        session,
        map,
        op: target,
        params: targetParams,
        confirm,
        idempotencyKey,
        audit:
          target === opDef
            ? (info) => {
                auditInfo = info;
              }
            : undefined,
      });

    if (opDef.effect === "read") {
      return text(
        JSON.stringify(await runExecutor(opDef, params, input.confirm, input.idempotency_key)),
      );
    }

    const safety = await runWrite({
      map,
      op: opDef,
      confirm: input.confirm,
      idempotencyKey: input.idempotency_key,
      ledger,
      execute: async (): Promise<WriteExecution> => {
        const envelope = await runExecutor(opDef, params, input.confirm, input.idempotency_key);

        return envelope.ok ? { ok: true, result: envelope.result } : toWriteFailure(envelope.error);
      },
      check:
        opDef.outcome_check === undefined
          ? undefined
          : async () => {
              const checkOp = map.ops.find((candidate) => candidate.name === opDef.outcome_check);
              if (checkOp === undefined) return { outcome: "unknown" };

              const envelope = await runExecutor(checkOp, {}, false, undefined);
              return envelope.ok
                ? { outcome: "done", result: envelope.result }
                : { outcome: "unknown" };
            },
    });

    deps.sessions.recordAudit({
      id: randomUUID(),
      sid: session.sid,
      site: map.site,
      op: opDef.name,
      effect: opDef.effect,
      params,
      ...(input.idempotency_key !== undefined ? { idempotency_key: input.idempotency_key } : {}),
      ...(auditInfo?.tier !== undefined ? { tier: auditInfo.tier } : {}),
      ...(auditInfo?.beforeState !== undefined ? { before_state: auditInfo.beforeState } : {}),
      ...(auditInfo?.afterState !== undefined ? { after_state: auditInfo.afterState } : {}),
      ...(auditInfo?.requests !== undefined ? { requests: auditInfo.requests } : {}),
      outcome: safety.ok ? "done" : safety.code === "unknown_outcome" ? "unknown" : "not_done",
      created_at: new Date().toISOString(),
    });

    return text(
      JSON.stringify(
        safety.ok
          ? { ok: true, result: safety.result }
          : {
              ok: false,
              error: {
                code: safety.code,
                message: safety.message,
                ...(safety.details !== undefined ? { details: safety.details } : {}),
              },
            },
      ),
    );
  }

  function clearNativeTools(): void {
    for (const tool of nativeTools) tool.remove();
    nativeTools = [];
  }

  function registerNativeTools(map: SiteMap): void {
    clearNativeTools();

    const used = new Set(["list_sites", "open_site", "call"]);

    for (const op of map.ops.slice(0, budget)) {
      const name = sanitizeToolName(toolName(map.site, op.name));
      if (used.has(name)) continue;
      used.add(name);

      const registered = server.registerTool(
        name,
        {
          description: `${op.summary} [${op.effect}]`,
          inputSchema: nativeZodShape(op),
        },
        async (args) => {
          const { confirm, idempotency_key, ...params } = args;

          return callOp({
            op: op.name,
            params,
            confirm: confirm === true,
            idempotency_key: typeof idempotency_key === "string" ? idempotency_key : undefined,
          });
        },
      );

      nativeTools.push(registered);
    }

    server.sendToolListChanged();
  }

  server.registerTool(
    "list_sites",
    {
      description: "List the sites this server has a map for.",
      inputSchema: {},
    },
    async () => text(JSON.stringify(deps.maps.list())),
  );

  server.registerTool(
    "open_site",
    {
      description: "Open a site and pin its map version.",
      inputSchema: { site: z.string().min(1).max(64) },
    },
    async ({ site }) => {
      const map = deps.maps.get(site);
      if (map === undefined) {
        return failure("map_not_found", `no map for site "${site}"`);
      }

      if (currentSid !== undefined) {
        deps.sessions.close(currentSid);
      }

      const session = deps.sessions.create({ site });
      deps.sessions.pin(session.sid, map.version);
      currentSid = session.sid;

      registerNativeTools(map);

      return text(
        JSON.stringify({
          sid: session.sid,
          site,
          map_version: map.version,
          map: renderMap(map),
        }),
      );
    },
  );

  server.registerTool(
    "call",
    {
      description: "Call one op on the open site.",
      inputSchema: {
        op: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
        idempotency_key: z.string().min(1).max(200).optional(),
        confirm: z.boolean().optional(),
      },
    },
    async (input) => callOp(input),
  );

  return server;
}

/**
 * Native tool names must match `^[a-zA-Z0-9_-]{1,64}$`. Valid maps already
 * satisfy that, so this is a defensive layer for imported maps.
 */
export function sanitizeToolName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return sanitized.length === 0 ? "tool" : sanitized;
}

/**
 * A Zod shape for a native tool.
 *
 * The SDK's `registerTool` only accepts Zod, so the shape is derived from the
 * op's JSON Schema and Ajv remains the authoritative validator inside
 * `callOp`. `confirm` stays optional so the runtime, not the client's schema
 * check, returns `needs_confirmation`.
 */
function nativeZodShape(op: OpDef): Record<string, z.ZodTypeAny> {
  const properties = asRecord(op.params.properties) ?? {};
  const required = new Set(
    Array.isArray(op.params.required)
      ? op.params.required.filter((value): value is string => typeof value === "string")
      : [],
  );

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, schema] of Object.entries(properties)) {
    const field = zodFor(schema);
    shape[key] = required.has(key) ? field : field.optional();
  }

  if (op.effect === "irreversible") {
    shape.confirm = z.boolean().optional();
  }
  if (op.effect !== "read") {
    shape.idempotency_key = z.string().min(1).max(200).optional();
  }

  return shape;
}

function zodFor(schema: unknown): z.ZodTypeAny {
  const record = asRecord(schema);

  switch (record?.type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.unknown());
    case "object":
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function toWriteFailure(error: ProtocolError): Extract<WriteExecution, { ok: false }> {
  const allowed: WriteFailureCode[] = [
    "invalid_params",
    "precondition_failed",
    "needs_confirmation",
    "op_broken",
    "unknown_outcome",
  ];
  const code = allowed.includes(error.code as WriteFailureCode)
    ? (error.code as WriteFailureCode)
    : "op_broken";

  return {
    ok: false,
    code,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

function failure(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  const error = details === undefined ? { code, message } : { code, message, details };

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error }) }],
    isError: true,
  };
}
