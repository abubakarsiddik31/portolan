import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ErrorCode, ResultEnvelope } from "@portolan/protocol";
import { createSessionRequestSchema } from "@portolan/protocol";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { ZodError } from "zod";

import { notReadyExecutor, type OpExecutor } from "./executor.js";
import type { MapStore } from "./maps.js";
import { createMcpServer } from "./mcp.js";
import type { SessionStore } from "./store.js";

export type ServerOptions = {
  store: SessionStore;
  logger?: boolean;
  /** Enables the MCP surface at POST /mcp when present. */
  maps?: MapStore;
  executor?: OpExecutor;
};

/**
 * The HTTP surface, as a factory.
 *
 * Tests use `app.inject` and never bind a port. `start.ts` is the only place
 * that listens. The store is passed in, not constructed here, so the server
 * can be tested against an in-memory database and never owns the handle.
 */
export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 400 && status < 500) {
      reply.code(status).send(failure("invalid_request", error.message));
      return;
    }

    reply.code(500).send(failure("internal", "internal server error"));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(failure("invalid_request", `no route for ${request.method} ${request.url}`));
  });

  app.get("/v1/health", async () => ({
    ok: true as const,
    result: { status: "ok" },
  }));

  app.post("/v1/sessions", async (request, reply) => {
    const parsed = createSessionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send(invalidBody(parsed.error));
      return;
    }

    reply.code(201).send({ ok: true, result: options.store.create(parsed.data) });
  });

  app.get<{ Params: { sid: string } }>("/v1/sessions/:sid", async (request, reply) => {
    const record = options.store.get(request.params.sid);
    if (record === undefined) {
      reply.code(404).send(sessionNotFound(request.params.sid));
      return;
    }

    return { ok: true, result: record };
  });

  app.get<{ Params: { sid: string } }>("/v1/sessions/:sid/audit", async (request, reply) => {
    const record = options.store.get(request.params.sid);
    if (record === undefined) {
      reply.code(404).send(sessionNotFound(request.params.sid));
      return;
    }

    return { ok: true, result: options.store.listAudit(request.params.sid) };
  });

  app.delete<{ Params: { sid: string } }>("/v1/sessions/:sid", async (request, reply) => {
    const { sid } = request.params;
    if (!options.store.close(sid)) {
      reply.code(404).send(sessionNotFound(sid));
      return;
    }

    return { ok: true, result: { sid, closed: true } };
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handleMcp = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (options.maps === undefined) {
      reply.code(404).send(failure("invalid_request", "mcp is not configured"));
      return;
    }

    const header = request.headers["mcp-session-id"];
    const sessionId = typeof header === "string" ? header : undefined;
    let transport = sessionId === undefined ? undefined : transports.get(sessionId);

    if (transport === undefined) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, created);
        },
      });

      created.onclose = () => {
        if (created.sessionId !== undefined) {
          transports.delete(created.sessionId);
        }
      };

      const mcp = createMcpServer({
        maps: options.maps,
        sessions: options.store,
        executor: options.executor ?? notReadyExecutor,
      });

      await mcp.connect(created);
      transport = created;
    }

    reply.hijack();

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
      }
      reply.raw.end();
    }
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  return app;
}

function failure(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ResultEnvelope {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}

function invalidBody(error: ZodError): ResultEnvelope {
  return failure("invalid_request", "request body is invalid", {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("/"),
      message: issue.message,
    })),
  });
}

function sessionNotFound(sid: string): ResultEnvelope {
  return failure("session_not_found", `no open session "${sid}"`);
}
