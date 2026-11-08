import { booleanFlag, listFlag, numberFlag, parseArgs, stringFlag } from "./args.js";
import { runBench } from "./commands/bench.js";
import { runCompile } from "./commands/compile.js";
import { runExportSkills } from "./commands/export-skills.js";
import { runInit } from "./commands/init.js";
import { runMcp } from "./commands/mcp.js";
import { runServe } from "./commands/serve.js";
import { runVerify } from "./commands/verify.js";
import { loadConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";

export const USAGE = `portolan <command> [options]

Commands:
  init [dir]             write a config, a policy, and the maps/skills dirs
  serve                  start the HTTP and MCP server
  mcp                    serve MCP over stdio (for a client to spawn)
  compile <trace...>     compile traces into a new map version
  verify                 verify a map's ops on a fresh session
  export-skills          export a portolan-<site> skill from a map
  bench [suite]          run a benchmark suite from the source checkout
  doctor [--json]        diagnose the browser, config, providers, and clients

Common options:
  --config <path>        config file (default ./portolan.config.json)
  --help                 show this message
`;

export type CliDeps = {
  init?: typeof runInit;
  serve?: typeof runServe;
  mcp?: typeof runMcp;
  compile?: typeof runCompile;
  verify?: typeof runVerify;
  exportSkills?: typeof runExportSkills;
  bench?: typeof runBench;
  doctor?: typeof runDoctor;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`));

  const [command, ...rest] = argv;

  if (
    command === undefined ||
    command === "--help" ||
    command === "-h" ||
    command === "help" ||
    rest.includes("--help")
  ) {
    out(USAGE);
    return 0;
  }

  try {
    const args = parseArgs(rest);

    switch (command) {
      case "init": {
        const result = (deps.init ?? runInit)({
          ...(args.positional[0] !== undefined ? { dir: args.positional[0] } : {}),
          ...(stringFlag(args, "site") !== undefined ? { site: stringFlag(args, "site") } : {}),
          force: booleanFlag(args, "force"),
        });
        out(`initialized ${result.dir}`);
        for (const file of result.files) out(`  wrote ${file}`);
        for (const file of result.skipped) out(`  kept  ${file}`);
        return 0;
      }

      case "serve": {
        const config = loadConfig(stringFlag(args, "config"));
        const host = stringFlag(args, "host");
        const port = numberFlag(args, "port");
        const database = stringFlag(args, "database");
        const maps = stringFlag(args, "maps");
        const handle = await (deps.serve ?? runServe)({
          config,
          ...(host !== undefined ? { host } : {}),
          ...(port !== undefined ? { port } : {}),
          ...(database !== undefined ? { database } : {}),
          ...(maps !== undefined ? { maps } : {}),
        });
        out(`listening on ${handle.url}`);
        installShutdown(deps.serve === undefined, handle);
        return 0;
      }

      case "mcp": {
        const config = loadConfig(stringFlag(args, "config"));
        const handle = await (deps.mcp ?? runMcp)({ config });
        installShutdown(deps.mcp === undefined, handle);
        return 0;
      }

      case "compile": {
        const config = loadConfig(stringFlag(args, "config"));
        const mapPath = required(args, "map");
        const traces = [...args.positional, ...listFlag(args, "trace")];
        const baseUrl = stringFlag(args, "base-url") ?? config.baseUrl;
        const outcomeChecksPath = stringFlag(args, "outcome-checks");
        const chrome = stringFlag(args, "chrome") ?? config.chrome;
        const result = await (deps.compile ?? runCompile)({
          mapPath,
          tracePaths: traces,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(outcomeChecksPath !== undefined ? { outcomeChecksPath } : {}),
          ...(chrome !== undefined ? { chrome } : {}),
          headless: booleanFlag(args, "headed") ? false : config.headless,
        });
        out(
          `published v${result.published.version} at ${result.published.path} (${result.candidates.length} candidates)`,
        );
        out(
          `  added ${result.published.diff.added.length}, changed ${result.published.diff.changed.length}, unchanged ${result.published.diff.unchanged.length}, held ${result.published.diff.held.length}, rejected ${result.published.diff.rejected.length}`,
        );
        return 0;
      }

      case "verify": {
        const config = loadConfig(stringFlag(args, "config"));
        const ops = listFlag(args, "op");
        const baseUrl = stringFlag(args, "base-url") ?? config.baseUrl;
        const chrome = stringFlag(args, "chrome") ?? config.chrome;
        const result = await (deps.verify ?? runVerify)({
          mapPath: required(args, "map"),
          paramsPath: required(args, "params"),
          ...(ops.length > 0 ? { ops } : {}),
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(chrome !== undefined ? { executablePath: chrome } : {}),
          headless: booleanFlag(args, "headed") ? false : config.headless,
        });
        for (const report of result.reports) {
          out(
            `${report.verified ? "ok  " : "FAIL"} ${report.op}${report.reason !== undefined ? ` — ${report.reason}` : ""}`,
          );
          for (const impl of report.impls) {
            out(
              `       ${impl.tier}: ${impl.verified ? "verified" : `unverified (${impl.reason ?? "no reason"})`}`,
            );
          }
        }
        return result.ok ? 0 : 1;
      }

      case "export-skills": {
        const config = loadConfig(stringFlag(args, "config"));
        const result = await (deps.exportSkills ?? runExportSkills)({
          mapPath: required(args, "map"),
          outDir: stringFlag(args, "out") ?? config.skills,
          ...(listFlag(args, "trace").length > 0 ? { tracePaths: listFlag(args, "trace") } : {}),
          ...(listFlag(args, "gotcha").length > 0 ? { gotchas: listFlag(args, "gotcha") } : {}),
        });
        out(`wrote ${result.skill.skillPath}`);
        out(
          `  ${result.skill.recipes.length} recipes, ${result.skill.validation.ok ? "valid" : "invalid"}`,
        );
        return result.skill.validation.ok ? 0 : 1;
      }

      case "bench": {
        const result = await (deps.bench ?? runBench)({
          ...(args.positional[0] !== undefined ? { suite: args.positional[0] } : {}),
          list: booleanFlag(args, "list"),
        });
        if (result.listed) {
          out(`suites: ${result.suites.join(", ")}`);
          return 0;
        }
        out(`suite ${result.suite} exited ${result.code}`);
        return result.code === 0 ? 0 : 1;
      }

      case "doctor": {
        const report = (deps.doctor ?? runDoctor)();
        out(booleanFlag(args, "json") ? JSON.stringify(report, null, 2) : formatDoctor(report));
        return report.ok ? 0 : 1;
      }

      default: {
        err(`unknown command: ${command}\n\n${USAGE}`);
        return 2;
      }
    }
  } catch (error) {
    err(`error: ${(error as Error).message}`);
    return 1;
  }
}

function required(args: ReturnType<typeof parseArgs>, name: string): string {
  const value = stringFlag(args, name);
  if (value === undefined || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function installShutdown(real: boolean, handle: { close: () => Promise<void> }): void {
  if (!real) return;

  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
