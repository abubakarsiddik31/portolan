import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";

import { books, findBook, type Loan, searchBooks } from "./data.js";
import { bookPage, catalogPage, errorPage, loansPage } from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

export async function buildLibraryApp(
  options: { logger?: boolean; variant?: "v1" | "v2" } = {},
): Promise<FastifyInstance> {
  const variant = options.variant ?? "v1";
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(formbody);

  const loans = new Map<string, Loan[]>();
  const borrowed = new Set<string>();
  let loanSeq = 7001;

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

  const loansFor = (sid: string): Loan[] => {
    const existing = loans.get(sid);
    if (existing !== undefined) return existing;
    const created: Loan[] = [];
    loans.set(sid, created);
    return created;
  };

  app.get("/health", async () => ({ ok: true, fixture: "library", version: variant }));

  app.get("/", async (request, reply) => {
    const list = loansFor(request.sid);
    return reply.type("text/html").send(catalogPage(books, "", list.length, variant));
  });

  app.get<{ Querystring: { q?: string } }>(
    variant === "v2" ? "/catalog" : "/search",
    async (request, reply) => {
      const query = request.query.q ?? "";
      const list = loansFor(request.sid);
      return reply
        .type("text/html")
        .send(catalogPage(searchBooks(query), query, list.length, variant));
    },
  );

  app.get<{ Params: { id: string } }>("/books/:id", async (request, reply) => {
    const book = findBook(request.params.id);
    if (book === undefined) {
      return reply.code(404).type("text/html").send(errorPage("Book not found"));
    }
    return reply.type("text/html").send(bookPage(book, loansFor(request.sid).length, variant));
  });

  app.post<{ Params: { id: string } }>("/books/:id/borrow", async (request, reply) => {
    const book = findBook(request.params.id);
    if (book === undefined || borrowed.has(book.id)) {
      return reply.code(400).type("text/html").send(errorPage("This copy is not available."));
    }

    borrowed.add(book.id);
    const loan: Loan = {
      id: `loan_${loanSeq++}`,
      bookId: book.id,
      title: book.title,
      borrowedAt: new Date().toISOString(),
    };
    loansFor(request.sid).push(loan);
    return reply.code(303).redirect("/loans");
  });

  app.get("/loans", async (request, reply) => {
    const list = loansFor(request.sid);
    return reply.type("text/html").send(loansPage(list, list.length));
  });

  app.get<{ Querystring: { q?: string; query?: string } }>("/api/books", async (request) => ({
    books: searchBooks((variant === "v2" ? request.query.query : request.query.q) ?? "").map(
      (book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        genre: book.genre,
        available: book.available,
      }),
    ),
  }));

  return app;
}
