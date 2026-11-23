import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledCandidate, PublishResult, VerifyReport } from "@abubakarsiddiik/compiler";
import type { SiteMap } from "@abubakarsiddiik/protocol";
import { QaStore, readCaseFile } from "@abubakarsiddiik/qa";
import type { StdioServerHandle } from "@abubakarsiddiik/server";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { isBooleanFlag, parseArgs } from "./args.js";
import { main } from "./cli.js";
import { runBench } from "./commands/bench.js";
import { runCompile } from "./commands/compile.js";
import { runExportSkills } from "./commands/export-skills.js";
import { runInit } from "./commands/init.js";
import { runMigrate } from "./commands/migrate.js";
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

  it("never lets --strict, --allow-cost or --no-dedupe take a value", () => {
    const args = parseArgs([
      "--strict",
      "a.json",
      "--allow-cost",
      "b.json",
      "--no-dedupe",
      "c.json",
    ]);
    expect(args.positional).toEqual(["a.json", "b.json", "c.json"]);
  });

  it("knows every flag the CLI reads as a boolean, so none swallows a positional", () => {
    const dir = join(import.meta.dirname, ".");
    const sources = [
      join(dir, "cli.ts"),
      ...readdirSync(join(dir, "commands"))
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => join(dir, "commands", name)),
    ];
    const names = new Set(
      sources.flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/booleanFlag\(args, "([a-z-]+)"\)/g)].map(
          (match) => match[1] as string,
        ),
      ),
    );

    expect(names.size).toBeGreaterThan(20);
    expect([...names].filter((name) => !isBooleanFlag(name))).toEqual([]);
  });

  it("keeps the token after a boolean flag as a positional", () => {
    const args = parseArgs(["--verify", "--publish", "trace-1.json", "trace-2.json"]);

    expect(args.flags).toMatchObject({ verify: true, publish: true });
    expect(args.positional).toEqual(["trace-1.json", "trace-2.json"]);
  });
});

describe("map capability", () => {
  it("adds an excluded capability and writes the ledger", async () => {
    const dir = tempDir();
    const result = capture();

    const code = await main(
      [
        "map",
        "capability",
        "add",
        "--site",
        "demo",
        "--maps",
        dir,
        "--page",
        "/resumes",
        "--kind",
        "button",
        "--name",
        "Delete resume",
        "--status",
        "excluded",
        "--reason",
        "destructive",
      ],
      { out: result.out, err: result.err },
    );

    expect(code).toBe(0);
    expect(result.lines.join("\n")).toContain(
      "0 mapped, 0 missing, 1 excluded, 0 stale (nothing actionable)",
    );

    const ledger = JSON.parse(readFileSync(join(dir, "demo", "capabilities.json"), "utf8")) as {
      capabilities: Array<Record<string, unknown>>;
    };
    expect(ledger.capabilities[0]).toMatchObject({
      status: "excluded",
      source: "manual",
      reason: "destructive",
    });
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

    expect(loadConfig(path)).toMatchObject({ site: "store", port: 5000, maps: join(dir, "maps") });
  });

  it("rejects an invalid type", () => {
    const dir = tempDir();
    const path = join(dir, "portolan.config.json");
    writeFileSync(path, JSON.stringify({ port: "5000" }));

    expect(() => loadConfig(path)).toThrow(/port/);
  });
});

describe("init", () => {
  it("seeds the policy allow list from --url", () => {
    const dir = tempDir();
    runInit({ dir, site: "store", url: "http://localhost:5173/admin" });

    const policy = JSON.parse(
      readFileSync(join(dir, ".portolan", "policies", "store.json"), "utf8"),
    );
    expect(policy).toEqual({ site: "store", allow: ["localhost:5173"] });
  });

  it("writes the config, policy, and directories", () => {
    const dir = tempDir();
    const result = runInit({ dir, site: "store" });

    const portolan = join(dir, ".portolan");

    expect(result.files).toHaveLength(5);
    expect(existsSync(join(portolan, "config.json"))).toBe(true);
    expect(existsSync(join(portolan, "policies", "store.json"))).toBe(true);
    expect(existsSync(join(portolan, "maps", "store"))).toBe(true);
    expect(existsSync(join(portolan, "skills", "portolan-map", "SKILL.md"))).toBe(true);
    expect(existsSync(join(portolan, "skills", "portolan", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(portolan, "skills", "portolan-map", "SKILL.md"), "utf8")).toContain(
      "--require-complete",
    );
    expect(readFileSync(join(portolan, ".gitignore"), "utf8")).toBe("state/\n");
    expect(JSON.parse(readFileSync(join(portolan, "policies", "store.json"), "utf8"))).toEqual({
      site: "store",
      allow: [],
    });
  });

  it("keeps existing files without force", () => {
    const dir = tempDir();
    runInit({ dir, site: "store" });
    const second = runInit({ dir, site: "store" });

    expect(second.files).toHaveLength(0);
    expect(second.skipped).toHaveLength(5);
  });

  it("merges map settings into a config that already has a qa block", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".portolan"), { recursive: true });
    writeFileSync(
      join(dir, ".portolan", "config.json"),
      JSON.stringify({ qa: { baseUrl: "http://app", database: ":memory:" } }),
    );

    runInit({ dir, site: "store" });

    const config = JSON.parse(
      readFileSync(join(dir, ".portolan", "config.json"), "utf8"),
    ) as Record<string, unknown> & { qa: { baseUrl: string } };
    expect(config.site).toBe("store");
    expect(config.maps).toBe(".portolan/maps");
    expect(config.qa.baseUrl).toBe("http://app");
  });

  it("adopts a legacy root config instead of dropping its settings", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "portolan.config.json"),
      JSON.stringify({ site: "legacy", port: 5000, qa: { baseUrl: "http://legacy" } }),
    );

    runInit({ dir });

    const config = JSON.parse(readFileSync(join(dir, ".portolan", "config.json"), "utf8")) as {
      site: string;
      port: number;
      qa: { baseUrl: string };
    };
    expect(config.site).toBe("legacy");
    expect(config.port).toBe(5000);
    expect(config.qa.baseUrl).toBe("http://legacy");
  });

  it("appends state/ to an existing .portolan/.gitignore", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".portolan"), { recursive: true });
    writeFileSync(join(dir, ".portolan", ".gitignore"), "node_modules\n");

    runInit({ dir });

    expect(readFileSync(join(dir, ".portolan", ".gitignore"), "utf8")).toBe(
      "node_modules\nstate/\n",
    );
  });
});

describe("migrate", () => {
  it("moves a legacy root layout into .portolan and rewrites the config", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "portolan.config.json"),
      JSON.stringify({
        maps: "maps",
        policies: "policies",
        database: "portolan.db",
        qa: { database: ".portolan/qa.db", cases: "qa/cases", runs: ".portolan/qa/runs" },
      }),
    );
    mkdirSync(join(dir, "qa", "cases"), { recursive: true });
    writeFileSync(join(dir, "qa", "cases", "a.json"), "{}");
    mkdirSync(join(dir, "maps", "store"), { recursive: true });
    mkdirSync(join(dir, "policies"), { recursive: true });
    writeFileSync(join(dir, "policies", "store.json"), "{}");
    mkdirSync(join(dir, "skills", "portolan-map"), { recursive: true });
    writeFileSync(join(dir, "skills", "portolan-map", "SKILL.md"), "x");
    writeFileSync(join(dir, "portolan.db"), "db");
    mkdirSync(join(dir, ".portolan"), { recursive: true });
    writeFileSync(join(dir, ".portolan", "qa.db"), "qa-db");
    writeFileSync(join(dir, ".gitignore"), "node_modules\n.portolan/\n");
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          other: { command: "other" },
          "portolan-qa": {
            command: "npx",
            args: ["-y", "-p", "@abubakarsiddiik/qa", "portolan-qa"],
          },
        },
      }),
    );

    const sink = capture();
    expect(await main(["migrate", dir], sink)).toBe(0);
    expect(sink.lines.join("\n")).toContain("updated");

    expect(existsSync(join(dir, ".portolan", "config.json"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "qa", "cases", "a.json"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "maps", "store"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "policies", "store.json"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "skills", "portolan-map", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "state", "portolan.db"))).toBe(true);
    expect(existsSync(join(dir, ".portolan", "state", "qa.db"))).toBe(true);
    expect(existsSync(join(dir, "portolan.config.json"))).toBe(false);
    expect(existsSync(join(dir, "portolan.db"))).toBe(false);

    expect(readFileSync(join(dir, ".gitignore"), "utf8")).not.toContain(".portolan/");
    expect(readFileSync(join(dir, ".portolan", ".gitignore"), "utf8")).toBe("state/\n");

    const config = JSON.parse(readFileSync(join(dir, ".portolan", "config.json"), "utf8")) as {
      maps: string;
      database: string;
      qa: { cases: string; database: string };
    };
    expect(config.maps).toBe(".portolan/maps");
    expect(config.database).toBe(".portolan/state/portolan.db");
    expect(config.qa.cases).toBe(".portolan/qa/cases");
    expect(config.qa.database).toBe(".portolan/state/qa.db");

    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    expect(mcp.mcpServers.other?.command).toBe("other");
    expect(mcp.mcpServers["portolan-qa"]?.command).toBe("portolan");
    expect(mcp.mcpServers["portolan-qa"]?.args).toEqual(["qa", "mcp"]);
    expect(mcp.mcpServers["portolan-qa"]?.env?.QA_CONFIG).toBe(
      join(dir, ".portolan", "config.json"),
    );
  });

  it("moves the QA database with verified cases", () => {
    const dir = tempDir();
    const casePath = join(dir, "qa", "cases", "auth", "login.json");
    mkdirSync(join(dir, "qa", "cases", "auth"), { recursive: true });
    writeFileSync(
      casePath,
      JSON.stringify({
        schema: 1,
        id: "auth/login",
        title: "Login",
        suite: "smoke",
        effect: "read",
        status: "draft",
        steps: [{ goto: "/sign-in" }],
      }),
    );
    mkdirSync(join(dir, ".portolan"), { recursive: true });

    const store = new QaStore(join(dir, ".portolan", "qa.db"));
    store.putCase(readCaseFile(casePath), { status: "verified", note: "seed" });
    expect(store.getCase("auth/login")?.row.status).toBe("verified");
    store.close();

    runMigrate({ root: dir });

    const moved = new QaStore(join(dir, ".portolan", "state", "qa.db"));
    expect(moved.getCase("auth/login")?.row.status).toBe("verified");
    moved.close();
  });

  it("refuses to overwrite a destination", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "portolan.config.json"), "{}");
    mkdirSync(join(dir, ".portolan"), { recursive: true });
    writeFileSync(join(dir, ".portolan", "config.json"), "{}");

    expect(() => runMigrate({ root: dir })).toThrow(/refusing to overwrite/);
    expect(existsSync(join(dir, "portolan.config.json"))).toBe(true);
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
        verifyOp: async (options) => ({ op: options.op.name, verified: true, impls: [] }),
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

  describe("a recorded write the map does not name", () => {
    const at = "2026-11-17T00:00:00.000Z";
    const act = (name: string, v: number, effects: unknown[] = []) => ({
      kind: "act",
      at,
      ref: `e${v}`,
      do: "click",
      locator: { role: "button", name, ordinal: 0 },
      doc: 1,
      v,
      url: "http://store.test/keys",
      effects,
      delta: { navigation: false, entries: [] },
    });

    function setup() {
      const dir = tempDir();
      const mapPath = join(dir, "v1.json");
      const tracePath = join(dir, "trace.json");
      writeFileSync(mapPath, readFileSync(STORE_MAP, "utf8"));
      writeFileSync(
        tracePath,
        JSON.stringify({
          scope_id: "run-1",
          sid: "s",
          intent: "create a key",
          effect: "write",
          started_at: at,
          ended_at: at,
          entries: [
            act("Create API Key", 1, [
              {
                kind: "network",
                method: "POST",
                url: "http://store.test/api/keys",
                status: 200,
                request_body: { name: "k" },
                response_body: { id: 1 },
              },
            ]),
            act("Done", 2),
          ],
        }),
      );
      return { dir, mapPath, tracePath };
    }

    it("names it after the write and holds it until --verify-writes with params", async () => {
      const { mapPath, tracePath } = setup();

      await expect(
        runCompile(
          { mapPath, tracePaths: [tracePath] },
          { verifyOp: async (o) => ({ op: o.op.name, verified: true, impls: [] }) },
        ),
      ).rejects.toThrow(/create_api_key is a write; verify it explicitly with --verify-writes/);
    });

    it("publishes it as a ui write once verified with explicit params", async () => {
      const { dir, mapPath, tracePath } = setup();
      const paramsPath = join(dir, "params.json");
      writeFileSync(
        paramsPath,
        JSON.stringify({ create_api_key: [{ name: "a" }, { name: "b" }, { name: "c" }] }),
      );

      const result = await runCompile(
        { mapPath, tracePaths: [tracePath], paramsPath, verifyWrites: true },
        { verifyOp: async (o) => ({ op: o.op.name, verified: true, impls: [] }) },
      );

      const op = result.published.map.ops.find((candidate) => candidate.name === "create_api_key");
      expect(op).toMatchObject({ effect: "write" });
      expect(op?.impls[0]?.tier).toBe("ui");
      expect(result.reports).toHaveLength(1);
    });

    it("does not publish a candidate that failed verification", async () => {
      const { dir, mapPath, tracePath } = setup();
      const paramsPath = join(dir, "params.json");
      writeFileSync(
        paramsPath,
        JSON.stringify({ create_api_key: [{ name: "a" }, { name: "b" }, { name: "c" }] }),
      );

      await expect(
        runCompile(
          { mapPath, tracePaths: [tracePath], paramsPath, verifyWrites: true },
          {
            verifyOp: async (o) => ({
              op: o.op.name,
              verified: false,
              impls: [],
              reason: "every impl failed",
            }),
          },
        ),
      ).rejects.toThrow(/nothing verified[\s\S]*create_api_key: every impl failed/);
    });
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

  it("prints a command's own flags for <command> --help", async () => {
    const sink = capture();
    expect(await main(["map", "--help"], sink)).toBe(0);
    const text = sink.lines.join("\n");
    for (const flag of [
      "--verify-writes",
      "--exclude",
      "--max-pages",
      "--base-url",
      "--traces-dir",
    ]) {
      expect(text).toContain(flag);
    }

    const verify = capture();
    expect(await main(["verify", "-h"], verify)).toBe(0);
    expect(verify.lines.join("\n")).toContain("--params");
  });

  it("prints the version for --version and -v", async () => {
    const sink = capture();
    expect(await main(["--version"], sink)).toBe(0);
    expect(sink.lines[0]).toMatch(/^\d+\.\d+\.\d+/);

    const short = capture();
    expect(await main(["-v"], short)).toBe(0);
    expect(short.lines[0]).toBe(sink.lines[0]);
  });

  it("shows the QA subcommand help for qa --help", async () => {
    const sink = capture();
    expect(await main(["qa", "--help"], sink)).toBe(0);
    const text = sink.lines.join("\n");
    expect(text).toContain("portolan qa <command>");
    expect(text).toContain("init");
    expect(text).toContain("doctor");
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
    expect(existsSync(join(dir, ".portolan", "config.json"))).toBe(true);
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
