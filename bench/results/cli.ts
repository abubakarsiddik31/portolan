import { readResults } from "./store.js";
import { writeTable } from "./table.js";

const file = process.argv[2] ?? "bench/results/results.jsonl";
const out = process.argv[3] ?? "bench/results/table.md";

const results = readResults(file);
writeTable(results, out);
console.log(`wrote ${out} from ${results.length} runs`);
