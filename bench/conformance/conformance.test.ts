import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const RECORD = JSON.parse(readFileSync(join(ROOT, "bench/results/conformance.json"), "utf8")) as {
  clients: Record<string, { status: "pass" | "fail"; detail: string }>;
};

describe("client conformance", () => {
  it("records three clients", () => {
    expect(Object.keys(RECORD.clients).sort()).toEqual(["claude-code", "codex-cli", "gemini-cli"]);
  });

  it("passes Claude Code and Gemini CLI", () => {
    expect(RECORD.clients["claude-code"]?.status).toBe("pass");
    expect(RECORD.clients["gemini-cli"]?.status).toBe("pass");
  });

  it("records the Codex account failure", () => {
    expect(RECORD.clients["codex-cli"]?.status).toBe("fail");
    expect(RECORD.clients["codex-cli"]?.detail).toContain("402");
  });
});
