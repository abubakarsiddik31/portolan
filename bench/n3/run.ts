import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findChrome } from "@portolan/substrate";
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
  console.error("Chrome is required for the N=3 run");
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

const tasks = loadTasks(join(import.meta.dirname, "../tasks/heldout"))
  .filter((task) => /#[1-3]$/.test(task.id))
  .sort((a, b) => a.template_id.localeCompare(b.template_id) || a.id.localeCompare(b.id));

const resultsDir = join(import.meta.dirname, "../results");
const resultsFile = join(resultsDir, "n3.jsonl");

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
  writeTable(results, join(resultsDir, "n3-table.md"));
  writeFinalTable(results, join(resultsDir, "n3-final-table.md"), {
    resamples: 2_000,
    seed: 42,
  });

  const finalTable = readFileSync(join(resultsDir, "n3-final-table.md"), "utf8").trim();

  writeFileSync(
    join(resultsDir, "n3.md"),
    [
      "# N=3 — arm C, scripted model",
      "",
      `${results.length} scored rows: 16 held-out templates, 3 param sets each.`,
      "The model is deterministic; this validates the harness and the frozen maps,",
      "not model quality.",
      "",
      finalTable,
      "",
      "## Coverage",
      "",
      "- **Arm C**: 48 rows.",
      "- **Arms A and B**: not run. A needs provider keys; B has only the store harness test.",
      "- **Arm D-oracle**: the held-out maps exist, but the runtime MCP executor is not wired",
      "  for them yet.",
      "- **Providers**: `scripted` only. The provider-Y transfer run is not run.",
      "",
      "Every row has `provider: scripted`, `model: scripted`, and `$0` cost.",
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
