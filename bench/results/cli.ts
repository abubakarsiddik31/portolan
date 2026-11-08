import { writeFinalTable } from "./score.js";
import { readResults } from "./store.js";
import { writeTable } from "./table.js";

const file = process.argv[2] ?? "bench/results/results.jsonl";
const out = process.argv[3] ?? "bench/results/table.md";
const finalOut = process.argv[4] ?? "bench/results/final-table.md";

const results = readResults(file);
writeTable(results, out);
writeFinalTable(results, finalOut);
console.log(`wrote ${out} and ${finalOut} from ${results.length} runs`);
