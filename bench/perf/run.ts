import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { budget, measurePerf, type PerfSample } from "./measure.js";

const samples = await measurePerf({ runs: Number(process.env.PERF_RUNS ?? 10) });
const results = join(import.meta.dirname, "../results");
const out = join(results, "perf.json");

mkdirSync(results, { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ generated_at: new Date().toISOString(), samples }, null, 2)}\n`,
);
writeFileSync(join(results, "perf.md"), table(samples));

for (const sample of samples) {
  console.log(
    `${sample.site}.${sample.op} (${sample.tier}): p50 ${sample.p50}ms, p95 ${sample.p95}ms, max ${sample.max}ms${sample.ok ? "" : " [FAILED]"}`,
  );
}
console.log(`wrote ${out} and ${join(results, "perf.md")}`);

function table(rows: PerfSample[]): string {
  const lines = [
    "# Op latency",
    "",
    `Generated ${new Date().toISOString()} with \`pnpm --filter @abubakarsiddiik/bench perf\`.`,
    "",
    "| Op | Tier | Runs | p50 | p95 | Max | Budget (p50) |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];

  for (const sample of rows) {
    lines.push(
      `| ${sample.site}.${sample.op} | ${sample.tier} | ${sample.runs} | ${sample.p50}ms | ${sample.p95}ms | ${sample.max}ms | ${budget(sample.tier)}ms |`,
    );
  }

  lines.push("", "Budgets: `ui` ≤500ms, `url`/`http` ≤150ms.");
  return `${lines.join("\n")}\n`;
}
