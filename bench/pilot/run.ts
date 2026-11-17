import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findChrome } from "@abubakarsiddiik/substrate";
import type { FastifyInstance } from "fastify";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRunnerScript, type ScriptStep } from "../repair/scripted-model.js";
import { writeFinalTable } from "../results/score.js";
import { appendResult, readResults } from "../results/store.js";
import { writeTable } from "../results/table.js";
import { runTask } from "../runner/runner.js";
import { SubstrateBackend } from "../runner/substrate-backend.js";
import { TaskSuccessChecker } from "../runner/task-checker.js";
import { scriptFor } from "../tasks/heldout-scripts.js";
import { loadTasks } from "../tasks/load.js";

const CHROME = findChrome();
if (CHROME === undefined) {
  console.error("Chrome is required for the pilot");
  process.exit(1);
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

const libraryApp = await buildLibraryApp();
const supportApp = await buildSupportApp();
const library = await listen(libraryApp);
const support = await listen(supportApp);

const tasks = loadTasks(join(import.meta.dirname, "../tasks/heldout")).filter((task) =>
  task.id.endsWith("#1"),
);
const resultsDir = join(import.meta.dirname, "../results");
const resultsFile = join(resultsDir, "pilot.jsonl");

mkdirSync(resultsDir, { recursive: true });
rmSync(resultsFile, { force: true });

try {
  for (const task of tasks) {
    const backend = new SubstrateBackend({
      baseURLs: { library, support },
      executablePath: CHROME,
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

      if (!outcome.success) {
        throw new Error(`${task.id} failed: ${outcome.detail ?? "unknown"}`);
      }

      appendResult(resultsFile, outcome.result);
    } finally {
      await backend.close();
    }
  }

  const results = readResults(resultsFile);
  writeTable(results, join(resultsDir, "pilot-table.md"));
  writeFinalTable(results, join(resultsDir, "pilot-final-table.md"), {
    resamples: 2_000,
    seed: 42,
  });

  const finalTable = readFileSync(join(resultsDir, "pilot-final-table.md"), "utf8").trim();

  writeFileSync(
    join(resultsDir, "pilot.md"),
    [
      "# Pilot N=1 — arm C",
      "",
      `${results.length} scored rows, one per held-out template, using the scripted model.`,
      "The model is deterministic; this pilot validates the harness, not model quality.",
      "",
      finalTable,
      "",
      "## Arms not run",
      "",
      "- **A (browser-use)**: blocked on `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.",
      "- **B (agent-browser)**: the harness test covers one store task; not part of this pilot.",
      "- **D-oracle**: the held-out fixtures have no oracle maps yet.",
      "",
      "Every row has `provider: scripted`, `model: scripted`, and `$0` cost. A real",
      "pilot needs provider keys and a local model; this one is the harness check.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(finalTable);
  console.log(`wrote ${results.length} rows to ${resultsFile}`);
} finally {
  await libraryApp.close();
  await supportApp.close();
}
