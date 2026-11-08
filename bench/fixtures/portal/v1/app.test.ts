import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPortalApp } from "./app.js";

let app: FastifyInstance;

const cookie = (sid: string) => ({ cookie: `sid=${sid}` });
const form = (sid: string) => ({
  ...cookie(sid),
  "content-type": "application/x-www-form-urlencoded",
});

async function login(sid: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/login",
    headers: form(sid),
    payload: "email=analyst%40example.com&password=portolan",
  });
  expect(response.statusCode).toBe(303);
}

beforeAll(async () => {
  app = await buildPortalApp();
});

afterAll(async () => {
  await app.close();
});

describe("data portal fixture v1", () => {
  it("redirects an unauthenticated visitor to login", async () => {
    const response = await app.inject({ method: "GET", url: "/", headers: cookie("anon") });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/login");
  });

  it("rejects a wrong password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/login",
      headers: form("bad-login"),
      payload: "email=analyst%40example.com&password=wrong",
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Invalid email or password");
  });

  it("logs in with the demo account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/login",
      headers: form("login"),
      payload: "email=analyst%40example.com&password=portolan",
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/");
  });

  it("renders the invoice table after login", async () => {
    const sid = "table";
    await login(sid);
    const response = await app.inject({ method: "GET", url: "/", headers: cookie(sid) });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("inv_1001");
    expect(response.body).toContain("invoice-table");
    expect(response.body).toContain("page-next");
  });

  it("filters by status", async () => {
    const sid = "filter";
    await login(sid);
    const response = await app.inject({
      method: "GET",
      url: "/?status=overdue",
      headers: cookie(sid),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-status="overdue"');
    expect(response.body).not.toContain('data-status="paid"');
  });

  it("paginates", async () => {
    const sid = "page";
    await login(sid);
    const first = await app.inject({ method: "GET", url: "/", headers: cookie(sid) });
    const second = await app.inject({ method: "GET", url: "/?page=2", headers: cookie(sid) });
    expect(first.body).toContain("inv_1001");
    expect(second.body).toContain("inv_1011");
    expect(second.body).not.toContain("inv_1001");
  });

  it("exports filtered rows as CSV", async () => {
    const sid = "csv";
    await login(sid);
    const response = await app.inject({
      method: "GET",
      url: "/export.csv?status=paid",
      headers: cookie(sid),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body.split("\n")[0]).toBe("invoice,vendor,category,amount,status,date");
    expect(response.body).toContain("inv_1001");
    expect(response.body).not.toContain("inv_1002");
  });

  it("serves filtered rows over the JSON API", async () => {
    const sid = "api";
    await login(sid);
    const response = await app.inject({
      method: "GET",
      url: "/api/rows?status=overdue",
      headers: cookie(sid),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.rows.every((row: { status: string }) => row.status === "overdue")).toBe(true);
  });

  it("summarizes the ledger", async () => {
    const sid = "summary";
    await login(sid);
    const response = await app.inject({
      method: "GET",
      url: "/api/summary",
      headers: cookie(sid),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(48);
    expect(body.total_cents).toBeGreaterThan(0);
    expect(body.by_status.paid + body.by_status.pending + body.by_status.overdue).toBe(48);
  });

  it("logs out", async () => {
    const sid = "logout";
    await login(sid);
    const logout = await app.inject({ method: "POST", url: "/logout", headers: cookie(sid) });
    expect(logout.statusCode).toBe(303);
    const after = await app.inject({ method: "GET", url: "/", headers: cookie(sid) });
    expect(after.statusCode).toBe(303);
    expect(after.headers.location).toBe("/login");
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true, fixture: "portal", version: "v1" });
  });
});
