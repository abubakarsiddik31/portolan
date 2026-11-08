import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { filterRows, type Row, type RowFilters, rows, summarize } from "./data.js";
import { loginPage, portalPage } from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

const DEMO_EMAIL = "analyst@example.com";
const DEMO_PASSWORD = "portolan";

type Session = { email: string };

type FilterQuery = {
  q?: string;
  status?: string;
  state?: string;
  category?: string;
  page?: string;
  p?: string;
};

function parseFilters(query: FilterQuery, variant: "v1" | "v2"): RowFilters {
  const page = Number.parseInt((variant === "v2" ? query.p : query.page) ?? "1", 10);
  return {
    q: query.q?.trim() ?? "",
    status: (variant === "v2" ? query.state : query.status) ?? "",
    category: query.category ?? "",
    page: Number.isFinite(page) ? page : 1,
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(list: Row[]): string {
  const header = ["invoice", "vendor", "category", "amount", "status", "date"].join(",");
  const lines = list.map((row) =>
    [row.id, row.vendor, row.category, (row.amountCents / 100).toFixed(2), row.status, row.date]
      .map(csvCell)
      .join(","),
  );
  return `${[header, ...lines].join("\n")}\n`;
}

export async function buildPortalApp(
  options: { logger?: boolean; variant?: "v1" | "v2" } = {},
): Promise<FastifyInstance> {
  const variant = options.variant ?? "v1";
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(formbody);

  const sessions = new Map<string, Session>();

  const requireSession = (
    request: FastifyRequest,
    reply: FastifyReply,
    api: boolean,
  ): Session | undefined => {
    const session = sessions.get(request.sid);
    if (session) return session;
    if (api) reply.code(401).send({ error: "needs_auth" });
    else reply.code(303).redirect("/login");
    return undefined;
  };

  app.addHook("preHandler", async (request, reply) => {
    const existing = request.cookies.sid;
    if (existing) {
      request.sid = existing;
      return;
    }
    const sid = randomUUID();
    reply.setCookie("sid", sid, { path: "/", httpOnly: true, sameSite: "lax" });
    request.sid = sid;
  });

  app.get("/health", async () => ({ ok: true, fixture: "portal", version: variant }));

  app.get("/login", async (request, reply) => {
    if (sessions.has(request.sid)) return reply.code(303).redirect("/");
    return reply.type("text/html").send(loginPage(undefined, variant));
  });

  app.post<{ Body: Record<string, unknown> }>("/login", async (request, reply) => {
    const email = typeof request.body.email === "string" ? request.body.email.trim() : "";
    const password =
      typeof request.body.password === "string" ? (request.body.password as string) : "";

    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      return reply
        .code(401)
        .type("text/html")
        .send(loginPage("Invalid email or password", variant));
    }

    sessions.set(request.sid, { email });
    return reply.code(303).redirect("/");
  });

  app.post("/logout", async (request, reply) => {
    sessions.delete(request.sid);
    return reply.code(303).redirect("/login");
  });

  app.get<{ Querystring: FilterQuery }>("/", async (request, reply) => {
    const session = requireSession(request, reply, false);
    if (!session) return reply;
    const filters = parseFilters(request.query, variant);
    const page = filterRows(rows, filters);
    return reply.type("text/html").send(portalPage(page, filters, session.email, variant));
  });

  app.get<{ Querystring: FilterQuery }>(
    variant === "v2" ? "/invoices.csv" : "/export.csv",
    async (request, reply) => {
      const session = requireSession(request, reply, true);
      if (!session) return reply;
      const filters = parseFilters(request.query, variant);
      const page = filterRows(rows, { ...filters, pageSize: 1000 });
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="invoices.csv"')
        .send(toCsv(page.rows));
    },
  );

  app.get<{ Querystring: FilterQuery }>("/api/rows", async (request, reply) => {
    const session = requireSession(request, reply, true);
    if (!session) return reply;
    const page = filterRows(rows, parseFilters(request.query, variant));
    return { rows: page.rows, total: page.total, page: page.page, pages: page.pages };
  });

  app.get("/api/summary", async (request, reply) => {
    const session = requireSession(request, reply, true);
    if (!session) return reply;
    const summary = summarize(rows);
    return {
      total_cents: summary.totalCents,
      count: summary.count,
      by_status: summary.byStatus,
    };
  });

  return app;
}
