import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ErrorCode, ResultEnvelope, SessionRecord } from "@abubakarsiddiik/protocol";
import { createSessionRequestSchema } from "@abubakarsiddiik/protocol";
import type { TraceStore, WriteLedger } from "@abubakarsiddiik/runtime";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { ZodError } from "zod";
import { BrowserRegistry } from "./browsers.js";
import type { CanaryScheduler } from "./canary.js";
import type { OpExecutor } from "./executor.js";
import { mergeHealth } from "./health.js";
import type { Logger } from "./log.js";
import type { MapStore } from "./maps.js";
import { createMcpServer, type FallbackSubstrate } from "./mcp.js";
import type { SessionStore } from "./store.js";

export type ServerOptions = {
  store: SessionStore;
  logger?: boolean;
  /** Enables the MCP surface at POST /mcp when present. */
  maps?: MapStore;
  executor?: OpExecutor;
  /** Started with the server and stopped when it closes. */
  canary?: CanaryScheduler;
  /** Idle time after which a session is closed. Default 30 minutes. */
  sessionTtlMs?: number;
  /** Maximum open sessions. Default 100. */
  maxOpenSessions?: number;
  /** How often the expiry sweep runs. Default 60 seconds. */
  cleanupIntervalMs?: number;
  /** Close sessions left open by a previous process at startup. Default true. */
  recoverSessions?: boolean;
  /** Browser resources owned by sessions. */
  browsers?: BrowserRegistry;
  /** Structured lifecycle events. */
  log?: Logger;
  /** Write ledger. Defaults to the store's SQLite ledger. */
  ledger?: WriteLedger;
  /** Persists fallback and explore traces as JSONL and HAR. */
  traceStore?: TraceStore;
  /** Creates the browser substrate used by view, act, and read. */
  substrateFactory?: (session: SessionRecord) => Promise<FallbackSubstrate> | FallbackSubstrate;
  /** When set, every route except /v1/health requires this bearer token. */
  authToken?: string;
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
  const ttl = options.sessionTtlMs ?? 30 * 60 * 1000;
  const cap = options.maxOpenSessions ?? 100;
  const browsers = options.browsers ?? new BrowserRegistry();

  if (options.recoverSessions !== false) {
    // A restart means the previous process's browsers are gone; no session
    // from that process can be resumed safely.
    const recovered = options.store.closeAllOpen();
    if (recovered > 0) options.log?.info("session.recovered", { count: recovered });

    const settled = options.store.settlePendingWrites();
    if (settled > 0) options.log?.warn("write.pending_settled", { count: settled });
  }

  const sweep = setInterval(() => {
    const swept = options.store.sweepExpired(ttl);
    if (swept.length > 0) options.log?.info("session.swept", { count: swept.length });
  }, options.cleanupIntervalMs ?? 60_000);
  sweep.unref();

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

  if (options.authToken !== undefined && options.authToken.length > 0) {
    const token = options.authToken;

    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/v1/health") return;

      const provided = bearer(request.headers.authorization);
      if (provided === undefined || !sameSecret(provided, token)) {
        reply.code(401).send(failure("needs_auth", "missing or invalid bearer token"));
      }
    });
  }

  app.addHook("onClose", async () => {
    clearInterval(sweep);
    const closed = options.store.closeAllOpen();
    const engineCount = browsers.size();
    await browsers.closeAll();
    options.log?.info("server.closed", { sessions: closed, browsers: engineCount });
  });

  options.canary?.start();
  app.addHook("onClose", async () => {
    options.canary?.stop();
  });

  app.get<{ Params: { site: string } }>("/v1/sites/:site/health", async (request, reply) => {
    if (options.maps === undefined) {
      reply.code(404).send(failure("invalid_request", "maps are not configured"));
      return;
    }

    const map = options.maps.get(request.params.site);
    if (map === undefined) {
      reply.code(404).send(failure("map_not_found", `no map for ${request.params.site}`));
      return;
    }

    return { ok: true, result: mergeHealth(map, options.store.listOpHealth(map.site)) };
  });

  app.post("/v1/sessions", async (request, reply) => {
    const parsed = createSessionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send(invalidBody(parsed.error));
      return;
    }

    options.store.sweepExpired(ttl);

    const open = options.store.countOpen();
    if (open >= cap) {
      options.log?.warn("session.cap_reached", { open, cap });
      reply.code(429).send(
        failure("precondition_failed", "session limit reached", {
          reason: "session_limit",
          open,
          cap,
        }),
      );
      return;
    }

    const session = options.store.create(parsed.data);
    options.log?.info("session.created", {
      sid: session.sid,
      ...(session.site !== undefined ? { site: session.site } : {}),
    });
    reply.code(201).send({ ok: true, result: session });
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

    await browsers.close(sid);
    options.log?.info("session.closed", { sid });
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
        ...(options.executor !== undefined ? { executor: options.executor } : {}),
        ledger: options.ledger ?? options.store.writeLedger(),
        ...(options.traceStore !== undefined ? { traceStore: options.traceStore } : {}),
        ...(options.substrateFactory !== undefined
          ? { substrateFactory: options.substrateFactory }
          : {}),
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

function bearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value !== undefined ? value : undefined;
}

function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
