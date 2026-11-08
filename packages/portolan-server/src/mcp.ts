import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ErrorCode, validateJsonSchema } from "@portolan/protocol";
import { z } from "zod";

import { notReadyExecutor, type OpExecutor } from "./executor.js";
import { type MapStore, renderMap } from "./maps.js";
import type { SessionStore } from "./store.js";

export type McpDeps = {
  maps: MapStore;
  sessions: SessionStore;
  /** Defaults to the honest "not implemented" executor. */
  executor?: OpExecutor;
};

/**
 * The portable MCP surface: `list_sites`, `open_site`, `call`.
 *
 * One server instance owns one "open site" and one session. stdio gets that
 * for free; the HTTP transport keeps one instance per MCP session id.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "portolan", version: "0.0.1" });
  const executor = deps.executor ?? notReadyExecutor;
  let currentSid: string | undefined;

  server.tool("list_sites", "List the sites this server has a map for.", {}, async () =>
    text(JSON.stringify(deps.maps.list())),
  );

  server.tool(
    "open_site",
    "Open a site and pin its map version.",
    { site: z.string().min(1).max(64) },
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

  server.tool(
    "call",
    "Call one op on the open site.",
    {
      op: z.string().min(1),
      params: z.record(z.string(), z.unknown()).optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
      confirm: z.boolean().optional(),
    },
    async ({ op, params, idempotency_key, confirm }) => {
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

      const opDef = map.ops.find((candidate) => candidate.name === op);
      if (opDef === undefined) {
        return failure("unknown_op", `no op "${op}" in ${site} v${version}`);
      }

      const callParams = params ?? {};
      const validation = validateJsonSchema(opDef.params, callParams);
      if (!validation.ok) {
        return failure("invalid_params", `params for "${op}" are invalid`, {
          issues: validation.issues,
        });
      }

      if (opDef.effect === "irreversible" && confirm !== true) {
        return failure("needs_confirmation", `"${op}" is irreversible; pass confirm: true`);
      }

      deps.sessions.touch(session.sid);

      const envelope = await executor({
        session,
        map,
        op: opDef,
        params: callParams,
        confirm,
        idempotencyKey: idempotency_key,
      });

      return text(JSON.stringify(envelope));
    },
  );

  return server;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function failure(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  const error = details === undefined ? { code, message } : { code, message, details };

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error }) }],
    isError: true,
  };
}
