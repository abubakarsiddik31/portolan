import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWizardApp } from "./app.js";

let app: FastifyInstance;

const cookie = (sid: string) => ({ cookie: `sid=${sid}` });
const form = (sid: string) => ({
  ...cookie(sid),
  "content-type": "application/x-www-form-urlencoded",
});

function multipart(
  sid: string,
  filename: string,
  content: string,
): { body: string; headers: Record<string, string> } {
  const boundary = "----portolan-test";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="terms"',
    "",
    "on",
    `--${boundary}`,
    `Content-Disposition: form-data; name="attachment"; filename="${filename}"`,
    "Content-Type: text/plain",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return {
    body,
    headers: { ...cookie(sid), "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function advanceToStep3(sid: string): Promise<void> {
  await app.inject({
    method: "POST",
    url: "/step/1",
    headers: form(sid),
    payload: "name=Ada+Lovelace&email=ada%40example.com",
  });
  await app.inject({
    method: "POST",
    url: "/step/2",
    headers: form(sid),
    payload: "company=Analytical+Engines&role=Engineer&teamSize=12",
  });
}

beforeAll(async () => {
  app = await buildWizardApp();
});

afterAll(async () => {
  await app.close();
});

describe("wizard fixture v1", () => {
  it("serves step 1", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/step/1",
      headers: cookie("step1"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Tell us about you");
  });

  it("rejects an invalid step 1", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/step/1",
      headers: form("invalid-step1"),
      payload: "name=&email=not-an-email",
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("Enter a valid email");
  });

  it("moves to step 2 with valid step 1 data", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/step/1",
      headers: form("advance"),
      payload: "name=Ada+Lovelace&email=ada%40example.com",
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/step/2");
  });

  it("moves to step 3 and shows the review", async () => {
    const sid = "review";
    await app.inject({
      method: "POST",
      url: "/step/1",
      headers: form(sid),
      payload: "name=Ada+Lovelace&email=ada%40example.com",
    });
    const step2 = await app.inject({
      method: "POST",
      url: "/step/2",
      headers: form(sid),
      payload: "company=Analytical+Engines&role=Engineer&teamSize=12",
    });
    expect(step2.statusCode).toBe(303);

    const step3 = await app.inject({ method: "GET", url: "/step/3", headers: cookie(sid) });
    expect(step3.statusCode).toBe(200);
    expect(step3.body).toContain("Analytical Engines");
    expect(step3.body).toContain("Engineer");
  });

  it("accepts a valid upload and exposes a submission id", async () => {
    const sid = "submit";
    await advanceToStep3(sid);

    const request = multipart(sid, "brief.txt", "hello");
    const response = await app.inject({
      method: "POST",
      url: "/submit",
      headers: request.headers,
      payload: request.body,
    });
    expect(response.statusCode).toBe(303);
    const location = response.headers.location;
    expect(location).toMatch(/^\/done\/sub_\d+$/);

    const done = await app.inject({
      method: "GET",
      url: location as string,
      headers: cookie(sid),
    });
    expect(done.body).toContain("data-submission-id");
  });

  it("rejects a disallowed file type", async () => {
    const sid = "bad-file";
    await advanceToStep3(sid);

    const request = multipart(sid, "payload.exe", "nope");
    const response = await app.inject({
      method: "POST",
      url: "/submit",
      headers: request.headers,
      payload: request.body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("Attach a PDF, TXT or PNG file");
  });

  it("reports the current step", async () => {
    const sid = "state";
    await app.inject({
      method: "POST",
      url: "/step/1",
      headers: form(sid),
      payload: "name=Ada+Lovelace&email=ada%40example.com",
    });
    const state = await app.inject({ method: "GET", url: "/api/state", headers: cookie(sid) });
    expect(state.json()).toMatchObject({ step: 2, data: { name: "Ada Lovelace" } });
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true, fixture: "wizard", version: "v1" });
  });
});
