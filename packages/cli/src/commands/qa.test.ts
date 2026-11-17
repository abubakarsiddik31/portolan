import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runQa } from "./qa.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "portolan-qa-cli-"));
}

function configRoot(baseUrl = "http://app"): string {
  const root = tempRoot();
  writeFileSync(
    join(root, "portolan.config.json"),
    JSON.stringify({ qa: { baseUrl, database: ":memory:" } }),
    "utf8",
  );
  return root;
}

function capture(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = [];
  return { lines, out: (line) => void lines.push(line) };
}

describe("runQa generate", () => {
  it("writes a draft case from a spec file", async () => {
    const root = configRoot();
    writeFileSync(
      join(root, "spec.json"),
      JSON.stringify({ title: "Login flow", steps: [{ goto: "/sign-in" }] }),
      "utf8",
    );

    const { lines, out } = capture();
    const code = await runQa(
      [
        "generate",
        "--spec",
        join(root, "spec.json"),
        "--json",
        "--config",
        join(root, "portolan.config.json"),
      ],
      { out },
    );

    expect(code).toBe(0);
    const report = JSON.parse(lines.join("\n")) as { case_id: string; path: string };
    expect(report.case_id).toBe("login-flow");
    expect(existsSync(join(root, "qa", "cases", "login-flow.json"))).toBe(true);
  });

  it("writes a draft case from a trace file", async () => {
    const root = configRoot();
    writeFileSync(
      join(root, "trace.json"),
      JSON.stringify({
        scope_id: "s1",
        sid: "s1",
        intent: "open the jobs page",
        effect: "read",
        started_at: "x",
        entries: [{ kind: "view", at: "t0", doc: 1, v: 1, url: "http://app/jobs", affordances: 1 }],
      }),
      "utf8",
    );

    const { lines, out } = capture();
    const code = await runQa(
      [
        "generate",
        "--from-trace",
        join(root, "trace.json"),
        "--json",
        "--config",
        join(root, "portolan.config.json"),
      ],
      { out },
    );

    expect(code).toBe(0);
    const report = JSON.parse(lines.join("\n")) as { case_id: string };
    expect(report.case_id).toBe("open-the-jobs-page");
  });

  it("refuses to generate without a source", async () => {
    const root = configRoot();
    const errors: string[] = [];
    const code = await runQa(["generate", "--config", join(root, "portolan.config.json")], {
      err: (line) => void errors.push(line),
      out: () => {},
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage: portolan qa generate");
  });

  it("rejects a malformed --map", async () => {
    const root = configRoot();
    const errors: string[] = [];
    const code = await runQa(
      [
        "generate",
        "--spec",
        "missing.json",
        "--map",
        "nope",
        "--config",
        join(root, "portolan.config.json"),
      ],
      { err: (line) => void errors.push(line), out: () => {} },
    );
    expect(code).toBe(2);
    expect(errors[0]).toContain("--map must look like");
  });
});

describe("runQa repair", () => {
  it("refuses to repair without a case id", async () => {
    const root = configRoot();
    const errors: string[] = [];
    const code = await runQa(["repair", "--config", join(root, "portolan.config.json")], {
      err: (line) => void errors.push(line),
      out: () => {},
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage: portolan qa repair");
  });

  it("reports a case with no failed runs without editing it", async () => {
    const root = configRoot();
    mkdirSync(join(root, "qa", "cases", "auth"), { recursive: true });
    writeFileSync(
      join(root, "qa", "cases", "auth", "login.json"),
      JSON.stringify({
        schema: 1,
        id: "auth/login",
        title: "Login",
        suite: "smoke",
        effect: "read",
        status: "draft",
        steps: [{ goto: "/sign-in" }],
      }),
      "utf8",
    );

    const { lines, out } = capture();
    const code = await runQa(
      ["repair", "auth/login", "--json", "--config", join(root, "portolan.config.json")],
      {
        out,
      },
    );

    expect(code).toBe(1);
    const report = JSON.parse(lines.join("\n")) as { repaired: boolean; reason: string };
    expect(report.repaired).toBe(false);
    expect(report.reason).toContain("no failed run recorded");
  });
});
