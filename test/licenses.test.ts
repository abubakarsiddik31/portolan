import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("licenses", () => {
  it("ships the three license files", () => {
    expect(existsSync(join(ROOT, "LICENSE"))).toBe(true);
    expect(readFileSync(join(ROOT, "LICENSE-MIT"), "utf8")).toContain("MIT License");
    expect(readFileSync(join(ROOT, "LICENSE-CC-BY-4.0"), "utf8")).toContain(
      "Attribution 4.0 International",
    );
  });

  it("has no AGPL, GPL, or SSPL in the production graph", () => {
    const output = execFileSync(process.execPath, [join(ROOT, "scripts/check-licenses.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(output).toContain("No AGPL, GPL, or SSPL");
    expect(output).toContain("MIT");
  });
});
