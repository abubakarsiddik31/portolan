import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DOC = readFileSync(join(import.meta.dirname, "../docs/BENCHMARK.md"), "utf8");

describe("benchmark report", () => {
  it("names every arm and every gate", () => {
    for (const term of ["Arm A", "Arm B", "Arm C", "Arm D", "G0", "G1", "G2"]) {
      expect(DOC, `missing ${term}`).toContain(term);
    }
  });

  it("states that the gates are not passed", () => {
    expect(DOC).toContain("not passed");
    expect(DOC).toContain("not run");
    expect(DOC).toContain("release gate stays closed");
    expect(DOC).toContain("ADR-005");
  });

  it("links the raw data", () => {
    for (const file of ["n3.jsonl", "drift.json", "conformance.json", "perf.json", "freeze.json"]) {
      expect(DOC, `missing ${file}`).toContain(file);
    }
  });

  it("says what is missing", () => {
    expect(DOC).toContain("second provider");
    expect(DOC).toContain("oracle");
    expect(DOC).toContain("billed usage");
    expect(DOC).toContain("real-model");
  });
});
