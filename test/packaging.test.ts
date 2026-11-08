import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../scripts/verify-packages.mjs");

describe("packaging", () => {
  it("every package is publishable and the Dockerfile ships Chromium", () => {
    const output = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });

    expect(output).toContain("packaging check passed");
  });
});
