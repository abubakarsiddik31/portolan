import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";

import { filterTickets, findTicket, type Ticket, tickets } from "./data.js";
import { errorPage, loginPage, newTicketPage, ticketPage, ticketsPage } from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

const DEMO_EMAIL = "agent@example.com";
const DEMO_PASSWORD = "support";

type FilterQuery = {
  q?: string;
  status?: string;
  state?: string;
  page?: string;
  p?: string;
};

export async function buildSupportApp(
  options: { logger?: boolean; variant?: "v1" | "v2" } = {},
): Promise<FastifyInstance> {
  const variant = options.variant ?? "v1";
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(formbody);

  const sessions = new Map<string, { email: string }>();
  let ticketSeq = 2001;

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

  const parseFilters = (query: FilterQuery) => ({
    q: query.q?.trim() ?? "",
    status: (variant === "v2" ? query.state : query.status) ?? "",
    page: Number.parseInt((variant === "v2" ? query.p : query.page) ?? "1", 10) || 1,
  });

  app.get("/health", async () => ({ ok: true, fixture: "support", version: variant }));

  app.get("/login", async (request, reply) => {
    if (sessions.has(request.sid)) return reply.code(303).redirect("/");
    return reply.type("text/html").send(loginPage(undefined, variant));
  });

  app.post<{ Body: Record<string, unknown> }>("/login", async (request, reply) => {
    const email = typeof request.body.email === "string" ? request.body.email.trim() : "";
    const password = typeof request.body.password === "string" ? request.body.password : "";

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

  app.get("/", async (request, reply) => {
    const session = sessions.get(request.sid);
    if (session === undefined) return reply.code(303).redirect("/login");

    const filters = parseFilters(request.query as FilterQuery);
    return reply
      .type("text/html")
      .send(ticketsPage(filterTickets(filters), filters, session.email, variant));
  });

  app.get<{ Params: { id: string } }>("/tickets/:id", async (request, reply) => {
    const session = sessions.get(request.sid);
    if (session === undefined) return reply.code(303).redirect("/login");

    const ticket = findTicket(request.params.id);
    if (ticket === undefined) {
      return reply.code(404).type("text/html").send(errorPage("Ticket not found"));
    }

    return reply.type("text/html").send(ticketPage(ticket, variant));
  });

  app.get(variant === "v2" ? "/requests/new" : "/tickets/new", async (request, reply) => {
    const session = sessions.get(request.sid);
    if (session === undefined) return reply.code(303).redirect("/login");
    return reply.type("text/html").send(newTicketPage(variant));
  });

  app.post<{ Body: Record<string, unknown> }>("/api/tickets", async (request, reply) => {
    const session = sessions.get(request.sid);
    if (session === undefined) return reply.code(401).send({ ok: false, error: "needs_auth" });

    const subject = typeof request.body.subject === "string" ? request.body.subject.trim() : "";
    const priority =
      variant === "v2"
        ? typeof request.body.urgency === "string"
          ? request.body.urgency
          : ""
        : typeof request.body.priority === "string"
          ? request.body.priority
          : "";

    if (subject.length === 0 || !["low", "normal", "high"].includes(priority)) {
      return reply.code(400).send({ ok: false, error: "invalid_ticket" });
    }

    const ticket: Ticket = {
      id: `t_${ticketSeq++}`,
      subject,
      status: "open",
      priority: priority as Ticket["priority"],
      requester: session.email,
    };
    tickets.push(ticket);
    return { ok: true, ticket_id: ticket.id, redirect: `/tickets/${ticket.id}` };
  });

  app.get("/api/tickets", async (request, reply) => {
    const session = sessions.get(request.sid);
    if (session === undefined) return reply.code(401).send({ ok: false, error: "needs_auth" });
    return { tickets: tickets.map((ticket) => ({ ...ticket })) };
  });

  return app;
}
