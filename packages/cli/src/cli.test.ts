import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledCandidate, PublishResult, VerifyReport } from "@portolan/compiler";
import type { SiteMap } from "@portolan/protocol";
import type { StdioServerHandle } from "@portolan/server";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "./args.js";
import { main } from "./cli.js";
import { runBench } from "./commands/bench.js";
import { runCompile } from "./commands/compile.js";
import { runExportSkills } from "./commands/export-skills.js";
import { runInit } from "./commands/init.js";
import { runServe } from "./commands/serve.js";
import { runVerify } from "./commands/verify.js";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";

const STORE_MAP = join(import.meta.dirname, "../../../maps/store/v1.json");
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-cli-"));
  dirs.push(dir);
  return dir;
}

function map(): SiteMap {
  return JSON.parse(readFileSync(STORE_MAP, "utf8")) as SiteMap;
}

function capture(): { lines: string[]; out: (line: string) => void; err: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    out: (line) => void lines.push(line),
    err: (line) => void lines.push(`error: ${line}`),
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("parses positionals, flags, and repeated values", () => {
    const args = parseArgs([
      "a",
      "--site",
      "store",
      "--force",
      "--op",
      "x",
      "--op",
      "y",
      "--port=42",
    ]);

    expect(args.positional).toEqual(["a"]);
    expect(args.flags).toMatchObject({ site: "store", force: true, port: "42" });
    expect(args.lists.op).toEqual(["x", "y"]);
  });
});

describe("config", () => {
  it("returns the defaults when the file is missing", () => {
    expect(loadConfig(join(tempDir(), "nope.json"))).toMatchObject({ site: "site", port: 4200 });
  });

  it("merges a partial config over the defaults", () => {
    const dir = tempDir();
    const path = join(dir, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ site: "store", port: 5000 }));

    expect(loadConfig(path)).toMatchObject({ site: "store", port: 5000, maps: "maps" });
  });

  it("rejects an invalid type", () => {
    const dir = tempDir();
    const path = join(dir, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ port: "5000" }));

    expect(() => loadConfig(path)).toThrow(/port/);
  });
});

describe("init", () => {
  it("writes the config, policy, and directories", () => {
    const dir = tempDir();
    const result = runInit({ dir, site: "store" });

    expect(result.files).toHaveLength(2);
    expect(existsSync(join(dir, "portolan.config.json"))).toBe(true);
    expect(existsSync(join(dir, "policies", "store.json"))).toBe(true);
    expect(existsSync(join(dir, "maps", "store"))).toBe(true);
    expect(existsSync(join(dir, "skills"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "policies", "store.json"), "utf8"))).toEqual({
      site: "store",
      allow: [],
    });
  });

  it("keeps existing files without force", () => {
    const dir = tempDir();
    runInit({ dir, site: "store" });
    const second = runInit({ dir, site: "store" });

    expect(second.files).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
  });
});

describe("export-skills", () => {
  it("exports a valid skill from a real map", async () => {
    const out = tempDir();
    const result = await runExportSkills({ mapPath: STORE_MAP, outDir: out });

    expect(result.skill.name).toBe("portolan-store");
    expect(result.skill.validation.ok).toBe(true);
    expect(existsSync(result.skill.skillPath)).toBe(true);
    expect(readFileSync(result.skill.skillPath, "utf8")).toContain("map_version: 1");
  });
});

describe("compile", () => {
  it("publishes the candidates from injected compiler functions", async () => {
    const dir = tempDir();
    const mapPath = join(dir, "v1.json");
    const tracePath = join(dir, "trace.json");
    writeFileSync(mapPath, readFileSync(STORE_MAP, "utf8"));
    writeFileSync(
      tracePath,
      JSON.stringify({
        scope_id: "s",
        sid: "s",
        intent: "search",
        effect: "read",
        started_at: "x",
        entries: [],
      }),
    );

    const siteMap = map();
    const candidate = {
      op: siteMap.ops[0],
      tier: "ui",
      segment: {},
    } as unknown as CompiledCandidate;

    let publishedCandidates: unknown[] | undefined;
    const result = await runCompile(
      { mapPath, tracePaths: [tracePath] },
      {
        compileCandidates: async () => [candidate],
        publishMap: async (options) => {
          publishedCandidates = options.candidates;
          return {
            version: 2,
            path: join(dir, "v2.json"),
            map: siteMap,
            diff: { added: [], changed: ["search"], unchanged: [], held: [], rejected: [] },
          } satisfies PublishResult;
        },
      },
    );

    expect(result.published.version).toBe(2);
    expect(publishedCandidates).toHaveLength(1);
  });

  it("rejects a file that is not a trace", async () => {
    const dir = tempDir();
    const mapPath = join(dir, "v1.json");
    const tracePath = join(dir, "trace.json");
    writeFileSync(mapPath, readFileSync(STORE_MAP, "utf8"));
    writeFileSync(tracePath, "{}");

    await expect(runCompile({ mapPath, tracePaths: [tracePath] })).rejects.toThrow(/no entries/);
  });
});

describe("verify", () => {
  it("verifies each requested op and reports a missing param set", async () => {
    const dir = tempDir();
    const mapPath = join(dir, "v1.json");
    const paramsPath = join(dir, "params.json");
    writeFileSync(mapPath, readFileSync(STORE_MAP, "utf8"));
    writeFileSync(paramsPath, JSON.stringify({ search: [{}, {}, {}] }));

    const report: VerifyReport = {
      op: "search",
      verified: true,
      impls: [{ tier: "url", verified: true, runs: [] }],
    };

    const result = await runVerify(
      { mapPath, paramsPath, ops: ["search", "get_product"] },
      { verifyOp: async () => report },
    );

    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]?.verified).toBe(true);
    expect(result.reports[1]?.reason).toMatch(/no param sets/);
    expect(result.ok).toBe(false);
  });
});

describe("bench", () => {
  it("lists suites when asked", async () => {
    const result = await runBench({ list: true });
    expect(result).toMatchObject({ listed: true });
    if (result.listed) expect(result.suites).toContain("drift");
  });

  it("runs the named suite through the injected runner", async () => {
    const ran: string[] = [];
    const result = await runBench(
      { suite: "drift" },
      {
        run: async (suite) => {
          ran.push(suite);
          return 0;
        },
      },
    );

    expect(ran).toEqual(["drift"]);
    expect(result).toMatchObject({ listed: false, suite: "drift", code: 0 });
  });

  it("rejects an unknown suite", async () => {
    await expect(runBench({ suite: "nope" })).rejects.toThrow(/unknown suite/);
  });
});

describe("serve", () => {
  it("refuses a public bind without a token", async () => {
    await expect(
      runServe({
        config: { ...DEFAULT_CONFIG, database: ":memory:" },
        host: "0.0.0.0",
        authToken: "",
      }),
    ).rejects.toThrow(/refusing to bind/);
  });

  it("starts the app and closes the store", async () => {
    const closed: string[] = [];
    const fake = {
      server: { address: () => ({ port: 4321 }) },
      listen: async () => undefined,
      close: async () => void closed.push("app"),
    } as unknown as FastifyInstance;

    let seen: { browsers?: unknown; substrateFactory?: unknown } | undefined;
    const handle = await runServe(
      {
        config: { ...DEFAULT_CONFIG, site: "store", database: ":memory:", port: 0 },
      },
      {
        createApp: (options) => {
          seen = options as { browsers?: unknown; substrateFactory?: unknown };
          return fake;
        },
        substrateFactory: () =>
          ({
            view: async () => ({ snapshot: {}, refs: {} }),
            state: () => undefined,
            read: async () => ({ text: "" }),
            act: async () => ({ ok: false, code: "invalid_request", message: "test" }),
          }) as never,
      },
    );

    expect(handle.url).toBe("http://127.0.0.1:4321");
    expect(seen?.browsers).toBeDefined();
    expect(seen?.substrateFactory).toBeDefined();
    await handle.close();
    expect(closed).toEqual(["app"]);
  });
});

describe("main", () => {
  it("prints help and lists every command", async () => {
    const sink = capture();
    expect(await main(["--help"], sink)).toBe(0);
    const text = sink.lines.join("\n");

    for (const command of [
      "init",
      "serve",
      "compile",
      "verify",
      "export-skills",
      "bench",
      "doctor",
    ]) {
      expect(text).toContain(command);
    }
  });

  it("returns 2 for an unknown command", async () => {
    const sink = capture();
    expect(await main(["nope"], sink)).toBe(2);
  });

  it("returns 1 when a command throws", async () => {
    const sink = capture();
    expect(await main(["compile"], sink)).toBe(1);
    expect(sink.lines.join("\n")).toContain("--map is required");
  });

  it("runs init through the dispatcher", async () => {
    const dir = tempDir();
    const sink = capture();
    expect(await main(["init", dir, "--site", "store"], sink)).toBe(0);
    expect(existsSync(join(dir, "portolan.config.json"))).toBe(true);
  });

  it("runs mcp through the dispatcher without writing to stdout", async () => {
    const sink = capture();
    const handle = { close: async () => undefined } as unknown as StdioServerHandle;

    expect(
      await main(["mcp"], {
        ...sink,
        mcp: async () => handle,
      }),
    ).toBe(0);
    expect(sink.lines).toEqual([]);
  });

  it("runs bench --list through the dispatcher", async () => {
    const sink = capture();
    expect(await main(["bench", "--list"], sink)).toBe(0);
    expect(sink.lines.join("\n")).toContain("suites:");
  });

  it("runs doctor through the dispatcher", async () => {
    const sink = capture();
    expect(
      await main(["doctor"], {
        ...sink,
        doctor: () => ({ ok: true, checks: [] }),
      }),
    ).toBe(0);
  });
});
