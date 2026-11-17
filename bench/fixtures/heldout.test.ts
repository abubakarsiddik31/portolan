import { repairIntent } from "@abubakarsiddiik/compiler";
import { findChrome, PlaywrightEngine, Substrate } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRepairScript } from "../repair/scripted-model.js";
import { buildLibraryApp } from "./library/v1/app.js";
import { buildSupportApp } from "./support/v1/app.js";

const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe.skipIf(!ENABLED)("held-out fixtures", () => {
  const apps: FastifyInstance[] = [];
  let engine: PlaywrightEngine | undefined;
  let library = "";
  let libraryV2 = "";
  let support = "";
  let supportV2 = "";

  beforeAll(async () => {
    const libraryApp = await buildLibraryApp();
    const libraryV2App = await buildLibraryApp({ variant: "v2" });
    const supportApp = await buildSupportApp();
    const supportV2App = await buildSupportApp({ variant: "v2" });
    apps.push(libraryApp, libraryV2App, supportApp, supportV2App);

    library = await listen(libraryApp);
    libraryV2 = await listen(libraryV2App);
    support = await listen(supportApp);
    supportV2 = await listen(supportV2App);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    for (const app of apps) await app.close();
  });

  function current(): { engine: PlaywrightEngine; substrate: Substrate } {
    if (engine === undefined) throw new Error("the engine is not running");
    return { engine, substrate: new Substrate(engine) };
  }

  async function libraryBorrow(
    base: string,
    labels: { search: string; button: string },
  ): Promise<void> {
    const { engine, substrate } = current();
    await engine.navigate(base);

    const result = await repairIntent({
      model: createRepairScript([
        { kind: "act", role: "textbox", name: labels.search, do: "fill", value: "compilers" },
        { kind: "act", role: "button", name: labels.button, do: "click" },
        { kind: "act", role: "link", name: "Compilers at Dawn", do: "click" },
        {
          kind: "act",
          role: "button",
          name: labels.button === "Find" ? "Check out" : "Borrow",
          do: "click",
        },
        { kind: "done", answer: "Borrowed." },
      ]),
      substrate,
      goal: "Find Compilers at Dawn and borrow it.",
      effect: "write",
      maxSteps: 10,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        const text = await engine.evaluate<string>("document.body.innerText");
        return new URL(url).pathname === "/loans" && text.includes("Compilers at Dawn");
      },
    });

    expect(result.ok).toBe(true);
  }

  async function supportCreate(
    base: string,
    labels: { email: string; newLink: string; newButton: string; priority: string },
  ): Promise<void> {
    const { engine, substrate } = current();
    await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
    await engine.navigate(`${base}/login`);

    const result = await repairIntent({
      model: createRepairScript([
        {
          kind: "act",
          role: "textbox",
          name: labels.email,
          do: "fill",
          value: "agent@example.com",
        },
        { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
        { kind: "act", role: "button", name: "Sign in", do: "click" },
        { kind: "act", role: "link", name: labels.newLink, do: "click" },
        { kind: "act", role: "textbox", name: "Subject", do: "fill", value: "Printer is down" },
        { kind: "act", role: "combobox", name: labels.priority, do: "select", value: "high" },
        { kind: "act", role: "button", name: labels.newButton, do: "click" },
        { kind: "done", answer: "Opened." },
      ]),
      substrate,
      goal: "Open a high-priority ticket about the printer.",
      effect: "write",
      maxSteps: 15,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        const text = await engine.evaluate<string>("document.body.innerText");
        return new URL(url).pathname.startsWith("/tickets/") && text.includes("Printer is down");
      },
    });

    expect(result.ok).toBe(true);
  }

  async function supportFilter(base: string, statusLabel: string, key: string): Promise<void> {
    const { engine, substrate } = current();
    await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
    await engine.navigate(`${base}/login`);

    const result = await repairIntent({
      model: createRepairScript([
        {
          kind: "act",
          role: "textbox",
          name: key === "state" ? "Work email" : "Email",
          do: "fill",
          value: "agent@example.com",
        },
        { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
        { kind: "act", role: "button", name: "Sign in", do: "click" },
        { kind: "act", role: "combobox", name: statusLabel, do: "select", value: "open" },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        { kind: "done", answer: "Filtered." },
      ]),
      substrate,
      goal: "Filter tickets to open.",
      effect: "read",
      maxSteps: 10,
      check: async () => {
        const url = await engine.evaluate<string>("location.href");
        const statuses = await engine.evaluate<string[]>(
          "Array.from(document.querySelectorAll('[data-status]')).map((el) => el.dataset.status)",
        );
        return (
          new URL(url).searchParams.get(key) === "open" &&
          statuses.length > 0 &&
          statuses.every((status) => status === "open")
        );
      },
    });

    expect(result.ok).toBe(true);
  }

  it("runs the v1 library borrow and its predicate", async () => {
    await libraryBorrow(library, { search: "Search books", button: "Search" });
  }, 120_000);

  it("runs the v2 library borrow with the drifted labels", async () => {
    await libraryBorrow(libraryV2, { search: "Find books", button: "Find" });
  }, 120_000);

  it("runs the v1 support ticket and its predicate", async () => {
    await supportCreate(support, {
      email: "Email",
      newLink: "Create ticket",
      newButton: "Create ticket",
      priority: "Priority",
    });
  }, 120_000);

  it("runs the v2 support ticket with the drifted route and labels", async () => {
    await supportCreate(supportV2, {
      email: "Work email",
      newLink: "Open request",
      newButton: "Open request",
      priority: "Urgency",
    });
  }, 120_000);

  it("runs the v1 support filter", async () => {
    await supportFilter(support, "Status", "status");
  }, 120_000);

  it("runs the v2 support filter with the drifted query key", async () => {
    await supportFilter(supportV2, "Ticket status", "state");
  }, 120_000);
});
