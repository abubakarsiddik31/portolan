import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";

import { ROLES, type Submission, type WizardData, type WizardState } from "./data.js";
import { donePage, errorPage, step1Page, step2Page, step3Page } from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    sid: string;
  }
}

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".png"];
const MAX_FILE_BYTES = 1_000_000;

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? (body[key] as string).trim() : "";
}

function validateStep1(body: Record<string, unknown>): {
  data?: Pick<WizardData, "name" | "email">;
  errors: Record<string, string>;
} {
  const name = text(body, "name");
  const email = text(body, "email");
  const errors: Record<string, string> = {};

  if (!name) errors.name = "Enter your name";
  if (!email) errors.email = "Enter your email";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Enter a valid email";

  return Object.keys(errors).length > 0 ? { errors } : { data: { name, email }, errors };
}

function validateStep2(body: Record<string, unknown>): {
  data?: Pick<WizardData, "company" | "role" | "teamSize">;
  errors: Record<string, string>;
} {
  const company = text(body, "company");
  const role = text(body, "role");
  const teamSize = Number.parseInt(text(body, "teamSize"), 10);
  const errors: Record<string, string> = {};

  if (!company) errors.company = "Enter your company";
  if (!ROLES.includes(role as (typeof ROLES)[number])) errors.role = "Choose a role";
  if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 1000) {
    errors.teamSize = "Enter a team size between 1 and 1000";
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : { data: { company, role, teamSize }, errors };
}

function fileError(filename: string, size: number): string | undefined {
  const lower = filename.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "Attach a PDF, TXT or PNG file";
  }
  if (size > MAX_FILE_BYTES) return "Attachment must be 1 MB or smaller";
  return undefined;
}

export async function buildWizardApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 },
  });

  const states = new Map<string, WizardState>();
  const submissions = new Map<string, Submission>();
  let submissionSeq = 5001;

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

  const stateFor = (sid: string): WizardState => {
    const existing = states.get(sid);
    if (existing) return existing;
    const state: WizardState = { step: 1, data: {} };
    states.set(sid, state);
    return state;
  };

  app.get("/health", async () => ({ ok: true, fixture: "wizard", version: "v1" }));

  app.get("/", async (_request, reply) => reply.code(303).redirect("/step/1"));

  app.get<{ Params: { step: string } }>("/step/:step", async (request, reply) => {
    const step = Number.parseInt(request.params.step, 10);
    if (step !== 1 && step !== 2 && step !== 3) {
      return reply.code(404).type("text/html").send(errorPage("Step not found"));
    }
    const state = stateFor(request.sid);
    if (step > state.step) return reply.code(303).redirect(`/step/${state.step}`);

    if (step === 1) return reply.type("text/html").send(step1Page(state));
    if (step === 2) return reply.type("text/html").send(step2Page(state));
    return reply.type("text/html").send(step3Page(state));
  });

  app.post<{ Body: Record<string, unknown> }>("/step/1", async (request, reply) => {
    const state = stateFor(request.sid);
    const result = validateStep1(request.body);
    if (!result.data) {
      return reply.code(400).type("text/html").send(step1Page(state, result.errors));
    }
    state.data = { ...state.data, ...result.data };
    state.step = 2;
    return reply.code(303).redirect("/step/2");
  });

  app.post<{ Body: Record<string, unknown> }>("/step/2", async (request, reply) => {
    const state = stateFor(request.sid);
    const result = validateStep2(request.body);
    if (!result.data) {
      return reply.code(400).type("text/html").send(step2Page(state, result.errors));
    }
    state.data = { ...state.data, ...result.data };
    state.step = 3;
    return reply.code(303).redirect("/step/3");
  });

  app.post("/submit", async (request, reply) => {
    const state = stateFor(request.sid);
    if (state.step !== 3) return reply.code(303).redirect(`/step/${state.step}`);

    const fields: Record<string, string> = {};
    let attachment: { filename: string; size: number } | undefined;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buffer = await part.toBuffer();
          attachment = { filename: part.filename, size: buffer.length };
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch {
      return reply
        .code(413)
        .type("text/html")
        .send(step3Page(state, { attachment: "Attachment must be 1 MB or smaller" }));
    }

    if (!attachment) {
      return reply
        .code(400)
        .type("text/html")
        .send(step3Page(state, { attachment: "Attach a PDF, TXT or PNG file" }));
    }

    const problem = fileError(attachment.filename, attachment.size);
    if (problem) {
      return reply
        .code(400)
        .type("text/html")
        .send(step3Page(state, { attachment: problem }));
    }

    if (fields.terms !== "on" && fields.terms !== "true") {
      return reply
        .code(400)
        .type("text/html")
        .send(step3Page(state, { terms: "Confirm the details above are correct" }));
    }

    const submission: Submission = {
      id: `sub_${submissionSeq++}`,
      sid: request.sid,
      data: state.data as WizardData,
      fileName: attachment.filename,
      fileSize: attachment.size,
      submittedAt: new Date().toISOString(),
    };
    submissions.set(submission.id, submission);

    state.step = 1;
    state.data = {};
    return reply.code(303).redirect(`/done/${submission.id}`);
  });

  app.get<{ Params: { id: string } }>("/done/:id", async (request, reply) => {
    const submission = submissions.get(request.params.id);
    if (!submission || submission.sid !== request.sid) {
      return reply.code(404).type("text/html").send(errorPage("Submission not found"));
    }
    return reply.type("text/html").send(donePage(submission));
  });

  app.get("/api/state", async (request) => {
    const state = stateFor(request.sid);
    return { step: state.step, data: state.data };
  });

  return app;
}
