import { join } from "node:path";

import { repairIntent } from "@portolan/compiler";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRepairScript } from "../repair/scripted-model.js";
import { TaskSuccessChecker } from "../runner/task-checker.js";
import { evaluateBackend, scriptFor } from "./heldout-scripts.js";
import { loadTasks } from "./load.js";

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
