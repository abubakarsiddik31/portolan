import { join } from "node:path";

import { repairIntent } from "@portolan/compiler";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRepairScript, type ScriptStep } from "../repair/scripted-model.js";
import { TaskSuccessChecker } from "../runner/task-checker.js";
import type { ToolBackend } from "../runner/types.js";
import { type ExpandedTask, loadTasks } from "./load.js";

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

function evaluateBackend(engine: PlaywrightEngine): ToolBackend {
  return {
    async listTools() {
      return [];
    },
    async callTool(name, args) {
      if (name !== "evaluate") return { ok: false, text: `unknown tool "${name}"` };
      const value = await engine.evaluate<unknown>(String(args.expression));
      return { ok: true, text: JSON.stringify({ ok: true, value }) };
    },
    async close() {
      // The test owns the engine.
    },
  };
}

function loginSteps(): ScriptStep[] {
  return [
    {
      kind: "act",
      role: "textbox",
      name: "Email",
      do: "fill",
      value: "agent@example.com",
    },
    { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
    { kind: "act", role: "button", name: "Sign in", do: "click" },
  ];
}

function scriptFor(task: ExpandedTask): ScriptStep[] {
  const values = task.values;
  const done: ScriptStep = { kind: "done", answer: "Done." };

  switch (task.template_id) {
    case "library-search-open":
    case "library-author":
    case "library-genre":
    case "library-availability":
    case "library-back": {
      const query = values.query ?? values.author ?? values.genre ?? "";
      const steps: ScriptStep[] = [
        { kind: "act", role: "textbox", name: "Search books", do: "fill", value: query },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: values.title ?? "", do: "click" },
      ];

      if (task.template_id === "library-back") {
        steps.push({ kind: "act", role: "link", name: "← Back to catalog", do: "click" });
      }

      return [...steps, done];
    }
    case "library-borrow":
      return [
        {
          kind: "act",
          role: "textbox",
          name: "Search books",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        { kind: "act", role: "link", name: values.title ?? "", do: "click" },
        { kind: "act", role: "button", name: "Borrow", do: "click" },
        done,
      ];
    case "library-search-miss":
      return [
        {
          kind: "act",
          role: "textbox",
          name: "Search books",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Search", do: "click" },
        done,
      ];
    case "library-loans-empty":
      return [done];
    case "support-login":
      return [...loginSteps(), done];
    case "support-filter":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "combobox",
          name: "Status",
          do: "select",
          value: values.status ?? "open",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-filter-search":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "textbox",
          name: "Search",
          do: "fill",
          value: values.query ?? "",
        },
        {
          kind: "act",
          role: "combobox",
          name: "Status",
          do: "select",
          value: values.status ?? "open",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-search":
    case "support-search-miss":
      return [
        ...loginSteps(),
        {
          kind: "act",
          role: "textbox",
          name: "Search",
          do: "fill",
          value: values.query ?? "",
        },
        { kind: "act", role: "button", name: "Filter", do: "click" },
        done,
      ];
    case "support-paginate":
      return [...loginSteps(), { kind: "act", role: "link", name: "Next", do: "click" }, done];
    case "support-open-ticket":
      return [
        ...loginSteps(),
        { kind: "act", role: "link", name: values.subject ?? "", do: "click" },
        done,
      ];
    case "support-create":
      return [
        ...loginSteps(),
        { kind: "act", role: "link", name: "Create ticket", do: "click" },
        {
          kind: "act",
          role: "textbox",
          name: "Subject",
          do: "fill",
          value: values.subject ?? "",
        },
        {
          kind: "act",
          role: "combobox",
          name: "Priority",
          do: "select",
          value: values.priority ?? "normal",
        },
        { kind: "act", role: "button", name: "Create ticket", do: "click" },
        done,
      ];
    default:
      throw new Error(`no script for ${task.template_id}`);
  }
}

describe.skipIf(!ENABLED)("held-out templates", () => {
  const apps: FastifyInstance[] = [];
  let library = "";
  let support = "";

  beforeAll(async () => {
    const libraryApp = await buildLibraryApp();
    const supportApp = await buildSupportApp();
    apps.push(libraryApp, supportApp);
    library = await listen(libraryApp);
    support = await listen(supportApp);
  }, 60_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
  });

  const tasks = loadTasks(join(import.meta.dirname, "heldout")).filter((task) =>
    task.id.endsWith("#1"),
  );

  it("loads 16 held-out templates", () => {
    expect(tasks).toHaveLength(16);
    expect(new Set(tasks.map((task) => task.template_id)).size).toBe(16);
  });

  for (const task of tasks) {
    it(`${task.template_id} passes its predicate`, async () => {
      const active = await PlaywrightEngine.launch({ executablePath: CHROME as string });

      try {
        const substrate = new Substrate(active);
        const checker = new TaskSuccessChecker(evaluateBackend(active));
        const base = task.site === "library" ? library : support;

        await active.navigate(new URL(task.start, base).toString());

        const result = await repairIntent({
          model: createRepairScript(scriptFor(task)),
          substrate,
          goal: task.goal,
          effect:
            task.template_id === "library-borrow" || task.template_id === "support-create"
              ? "write"
              : "read",
          maxSteps: task.max_steps,
          check: async () => (await checker.check(task, [])).success,
        });

        expect(result.ok, `${task.id}: ${result.reason ?? "predicate failed"}`).toBe(true);
      } finally {
        await active.close();
      }
    }, 60_000);
  }
});
