import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findChrome } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRunnerScript, type ScriptStep } from "../repair/scripted-model.js";
import { renderFinalTable } from "../results/score.js";
import { appendResult, readResults } from "../results/store.js";
import { runTask } from "../runner/runner.js";
import { SubstrateBackend } from "../runner/substrate-backend.js";
import { TaskSuccessChecker } from "../runner/task-checker.js";
import { scriptFor } from "../tasks/heldout-scripts.js";
import { loadTasks } from "../tasks/load.js";

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

describe.skipIf(!ENABLED)("pilot", () => {
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

  it("produces a scored row for every held-out template on arm C", async () => {
    const tasks = loadTasks(join(import.meta.dirname, "../tasks/heldout")).filter((task) =>
      task.id.endsWith("#1"),
    );
    expect(tasks).toHaveLength(16);

    const temp = await mkdtemp(join(tmpdir(), "portolan-pilot-"));

    try {
      const file = join(temp, "pilot.jsonl");

      for (const task of tasks) {
        const backend = new SubstrateBackend({
          baseURLs: { library, support },
          executablePath: CHROME as string,
        });

        try {
          const steps = scriptFor(task);
          const expanded: ScriptStep[] = [];

          for (const step of steps) {
            if (step.kind === "act") expanded.push({ kind: "view" });
            expanded.push(step);
          }

          const outcome = await runTask({
            task,
            arm: "C",
            model: createRunnerScript(expanded),
            backend,
            provider: "scripted",
            modelId: "scripted",
            maxSteps: task.max_steps * 2 + 4,
            history: "full",
            checker: new TaskSuccessChecker(backend),
          });

          expect(outcome.success, `${task.id}: ${outcome.detail ?? "failed"}`).toBe(true);
          appendResult(file, outcome.result);
        } finally {
          await backend.close();
        }
      }

      const results = readResults(file);
      expect(results).toHaveLength(16);
      expect(results.every((result) => result.success)).toBe(true);

      const table = renderFinalTable(results, { resamples: 100, seed: 1 });
      expect(table).toContain("| C | 16 | 16 |");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 300_000);
});
