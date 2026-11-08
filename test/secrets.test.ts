import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DIRS = ["maps", "skills", "bench/results"];

const PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function filesIn(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesIn(path));
      continue;
    }

    if (/\.(json|jsonl|md|txt|yaml|yml|ts|js)$/.test(entry.name)) files.push(path);
  }

  return files;
}

describe("secret scan", () => {
  it("finds no credential pattern in maps, traces, logs, or skills", () => {
    const findings: string[] = [];

    for (const dir of DIRS) {
      for (const file of filesIn(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const pattern of PATTERNS) {
          if (pattern.test(text)) findings.push(`${file}: ${pattern}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
