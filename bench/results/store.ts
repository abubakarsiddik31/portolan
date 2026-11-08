import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { type RunResult, runResultSchema } from "./schema.js";

export function appendResult(file: string, result: RunResult): void {
  const parsed = runResultSchema.parse(result);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(parsed)}\n`, "utf8");
}

export function readResults(file: string): RunResult[] {
  const text = readFileSync(file, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return runResultSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`invalid result on line ${index + 1}: ${String(error)}`, { cause: error });
      }
    });
}
