import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { loadQaConfig } from "@abubakarsiddiik/qa";
import {
  agedOf,
  type CapabilityLedger,
  coverageOf,
  formatCoverage,
  gapsOf,
  makeCapabilityId,
  readCapabilities,
  unavailableOf,
  writeCapabilities,
} from "@abubakarsiddiik/sources";

import { booleanFlag, listFlag, numberFlag, parseArgs, stringFlag } from "./args.js";
import {
  authStatusLines,
  expiryOf,
  readRecipe,
  resolveLoginTarget,
  runAuthLogin,
  runAuthRefresh,
} from "./commands/auth.js";
import { type AuthRecipe, parseFill } from "./commands/auth-recipe.js";
import { runBench } from "./commands/bench.js";
import { runCompile } from "./commands/compile.js";
import { runExportSkills } from "./commands/export-skills.js";
import { runInit } from "./commands/init.js";
import { runMapBuild } from "./commands/map.js";
import { runMcp } from "./commands/mcp.js";
import { runMigrate } from "./commands/migrate.js";
import { blockedHosts, runPolicyAllow } from "./commands/policy.js";
import { runQa } from "./commands/qa.js";
import { runRecordGaps } from "./commands/record.js";
import { runServe } from "./commands/serve.js";
import { runVerify } from "./commands/verify.js";
import { loadConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { COMMAND_HELP } from "./help.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const VERSION: string = packageJson.version;

export const USAGE = `portolan <command> [options]

Commands:
  init [dir]             initialize .portolan/ (config, policy, maps, skills)
  migrate [dir]          move a legacy root layout into .portolan/
  auth login             open a browser, sign in, save the session for --storage-state
                         (--env NAME --profile P saves a named environment session)
  auth status            list environment profiles and whether a session is saved
  serve                  start the HTTP and MCP server
  mcp                    serve MCP over stdio (for a client to spawn)
  map <build|update>     discover a URL and/or traces into a map draft, verify, publish
  map record --gaps      record a one-click run for each missing capability
  map coverage           report mapped vs missing app capabilities
  map capability         add or set a capability manually (add|set)
  policy allow <host...> add hosts to a site's egress allow list
  compile <trace...>     compile traces into a new map version
  verify                 verify a map's ops on a fresh session
  export-skills          export a portolan-<site> skill from a map
  bench [suite]          run a benchmark suite from the source checkout
  qa <command>           local, agent-first QA (see: portolan qa --help)
  doctor [--json]        diagnose the browser, config, providers, and clients

Common options:
  --config <path>        config file (default ./.portolan/config.json)
  --version, -v          print the version
  --help                 show this message
`;

export type CliDeps = {
  init?: typeof runInit;
  migrate?: typeof runMigrate;
  serve?: typeof runServe;
  mcp?: typeof runMcp;
  compile?: typeof runCompile;
  map?: typeof runMapBuild;
  record?: typeof runRecordGaps;
  auth?: typeof runAuthLogin;
  authRefresh?: typeof runAuthRefresh;
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

  if (command === "--version" || command === "-v" || command === "version") {
    out(VERSION);
    return 0;
  }

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    out(USAGE);
    return 0;
  }

  if (command !== "qa" && (rest.includes("--help") || rest.includes("-h"))) {
    out(COMMAND_HELP[command] ?? USAGE);
    return 0;
  }

  try {
    const args = parseArgs(rest);

    switch (command) {
      case "init": {
        const result = (deps.init ?? runInit)({
          ...(args.positional[0] !== undefined ? { dir: args.positional[0] } : {}),
          ...(stringFlag(args, "site") !== undefined ? { site: stringFlag(args, "site") } : {}),
          ...(stringFlag(args, "url") !== undefined ? { url: stringFlag(args, "url") } : {}),
          force: booleanFlag(args, "force"),
        });
        out(`initialized ${result.dir}`);
        for (const file of result.files) out(`  wrote ${file}`);
        for (const file of result.skipped) out(`  kept  ${file}`);
        return 0;
      }

      case "migrate": {
        const result = (deps.migrate ?? runMigrate)({
          ...(args.positional[0] !== undefined ? { root: args.positional[0] } : {}),
        });
        if (result.moved.length === 0) out("nothing to migrate");
        else out(`migrated ${result.root} into ${result.dir}`);
        for (const item of result.moved) out(`  moved ${item.from} → ${item.to}`);
        for (const path of result.updated) out(`  updated ${path}`);
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
        installShutdown(deps.mcp === undefined, handle, { stdin: true });
        return 0;
      }

      case "auth": {
        const sub = args.positional[0];
        if (sub !== undefined && sub !== "login" && sub !== "status" && sub !== "refresh") {
          throw new Error(`unknown auth command "${sub}"; expected "login", "refresh" or "status"`);
        }

        if (sub === "status") {
          const stored = stringFlag(args, "storage-state");
          if (stored !== undefined) {
            out(
              existsSync(stored)
                ? `${stored}: saved${expiryOf(stored, Date.now())}${readRecipe(stored) !== undefined ? ", refreshable" : ""}`
                : `${stored}: no session`,
            );
            return 0;
          }
          const qa = loadQaConfig(stringFlag(args, "config"), process.env, { warn: err }).config;
          const lines = authStatusLines(qa.environments, qa.root);
          out(lines.length === 0 ? "no environments are configured" : lines.join("\n"));
          return 0;
        }

        if (sub === "refresh") {
          let target = stringFlag(args, "out") ?? stringFlag(args, "storage-state");
          const refreshEnv = stringFlag(args, "env");
          if (refreshEnv !== undefined) {
            const qa = loadQaConfig(stringFlag(args, "config"), process.env, { warn: err }).config;
            target = resolveLoginTarget(
              qa.environments,
              qa.root,
              refreshEnv,
              stringFlag(args, "profile"),
            ).out;
          }
          if (target === undefined) {
            throw new Error("auth refresh needs --env <name>, or --out <session file>");
          }
          const refreshed = await (deps.authRefresh ?? runAuthRefresh)({
            out: target,
            ...(stringFlag(args, "chrome") !== undefined
              ? { chrome: stringFlag(args, "chrome") }
              : {}),
          });
          out(`refreshed ${refreshed.out}`);
          return 0;
        }

        const config = loadConfig(stringFlag(args, "config"));
        const envName = stringFlag(args, "env");
        let url = stringFlag(args, "url");
        let outPath = stringFlag(args, "out");
        let confirm: (() => Promise<void>) | undefined;
        const fills = listFlag(args, "fill");
        const scriptPath = stringFlag(args, "script");
        let recipe: AuthRecipe | undefined;

        if (envName !== undefined) {
          if (url !== undefined || outPath !== undefined) {
            throw new Error("--env takes its sign-in page and session path from the config");
          }
          if (!process.stdin.isTTY && recipe === undefined) {
            throw new Error(
              "auth login --env needs a terminal for a person to confirm the sign-in, or --fill/--script to sign in unattended",
            );
          }
          const qa = loadQaConfig(stringFlag(args, "config"), process.env, { warn: err }).config;
          const target = resolveLoginTarget(
            qa.environments,
            qa.root,
            envName,
            stringFlag(args, "profile"),
          );
          url = target.url;
          outPath = target.out;
          confirm = async () => {
            const rl = createInterface({ input: process.stdin, output: process.stderr });
            try {
              await rl.question("Finish signing in (including MFA), then press Enter here: ");
            } finally {
              rl.close();
            }
          };
        }

        if (url === undefined) throw new Error("auth login needs --url <sign-in page> or --env");
        if (fills.length > 0 || scriptPath !== undefined) {
          recipe = {
            url,
            ...(fills.length > 0 ? { fills: fills.map(parseFill) } : {}),
            ...(stringFlag(args, "submit") !== undefined
              ? { submit: stringFlag(args, "submit") }
              : {}),
            ...(scriptPath !== undefined ? { script: resolve(scriptPath) } : {}),
          };
          confirm = undefined;
        }
        const result = await (deps.auth ?? runAuthLogin)({
          url,
          ...(recipe !== undefined ? { recipe } : {}),
          ...(confirm !== undefined ? { confirm } : {}),
          ...(outPath !== undefined ? { out: outPath } : {}),
          ...(stringFlag(args, "chrome") !== undefined
            ? { chrome: stringFlag(args, "chrome") }
            : config.chrome !== undefined
              ? { chrome: config.chrome }
              : {}),
          ...(numberFlag(args, "timeout-ms") !== undefined
            ? { timeoutMs: numberFlag(args, "timeout-ms") }
            : {}),
        });
        out(`saved ${result.out}`);
        out(
          envName !== undefined
            ? `next: portolan qa run --env ${envName} --all`
            : `next: portolan map build --storage-state ${result.out} --url <app url> --verify --publish`,
        );
        return 0;
      }

      case "map": {
        const config = loadConfig(stringFlag(args, "config"));
        const explicit = args.positional[0];
        const update = explicit === "update";
        const site = stringFlag(args, "site") ?? config.site;
        const mapsDir = stringFlag(args, "maps") ?? config.maps;

        if (explicit === "capability") {
          const sub = args.positional[1];
          const dir = join(mapsDir, site);
          const ledger: CapabilityLedger = readCapabilities(dir) ?? {
            schema: 1,
            site,
            generated_at: new Date().toISOString(),
            capabilities: [],
          };

          if (sub === "add") {
            const page = stringFlag(args, "page");
            const name = stringFlag(args, "name");
            const kind = stringFlag(args, "kind") ?? "button";
            if (page === undefined || name === undefined) {
              throw new Error("map capability add needs --page and --name");
            }
            if (kind !== "button" && kind !== "form" && kind !== "link") {
              throw new Error('--kind must be "button", "form", or "link"');
            }
            const status = stringFlag(args, "status") ?? "missing";
            if (status !== "missing" && status !== "excluded") {
              throw new Error('--status must be "missing" or "excluded"');
            }
            const reason = stringFlag(args, "reason");
            if (status === "excluded" && (reason === undefined || reason.length === 0)) {
              throw new Error("an excluded capability needs --reason");
            }
            const target = stringFlag(args, "target");
            if (kind === "link" && target === undefined) {
              throw new Error("a link capability needs --target <state id>");
            }
            const base = makeCapabilityId({
              page,
              kind,
              name,
              ...(target !== undefined ? { target } : {}),
            });
            const existing = ledger.capabilities.find((item) => item.id === base);
            if (existing !== undefined) {
              existing.status = status;
              existing.source = stringFlag(args, "source") === "code" ? "code" : "manual";
              if (reason !== undefined) existing.reason = reason;
            } else {
              ledger.capabilities.push({
                id: base,
                page,
                trigger: {
                  kind,
                  name,
                  ...(target !== undefined ? { target } : {}),
                },
                status,
                source: stringFlag(args, "source") === "code" ? "code" : "manual",
                ...(reason !== undefined ? { reason } : {}),
              });
            }
          } else if (sub === "set") {
            const id = stringFlag(args, "id");
            const status = stringFlag(args, "status");
            if (id === undefined || status === undefined) {
              throw new Error("map capability set needs --id and --status");
            }
            if (status !== "missing" && status !== "excluded") {
              throw new Error('--status must be "missing" or "excluded"');
            }
            const item = ledger.capabilities.find((candidate) => candidate.id === id);
            if (item === undefined) throw new Error(`no capability "${id}"`);
            const reason = stringFlag(args, "reason");
            if (status === "excluded" && (reason === undefined || reason.length === 0)) {
              throw new Error("an excluded capability needs --reason");
            }
            item.status = status;
            item.source = "manual";
            if (reason !== undefined) item.reason = reason;
          } else {
            throw new Error('map capability expects "add" or "set"');
          }

          ledger.generated_at = new Date().toISOString();
          const path = writeCapabilities(dir, ledger);
          const coverage = coverageOf(ledger);
          if (booleanFlag(args, "json")) {
            out(JSON.stringify({ coverage, ledger }, null, 2));
          } else {
            out(`${site}: ${formatCoverage(coverage)}`);
            out(`  ${path}`);
          }
          return 0;
        }

        if (explicit === "record") {
          if (!booleanFlag(args, "gaps")) {
            throw new Error(
              "map record needs --gaps: it records a run for each missing capability",
            );
          }
          const split = (name: string): string[] | undefined => {
            const value = stringFlag(args, name);
            return value === undefined ? undefined : value.split(",").map((part) => part.trim());
          };
          const chrome = stringFlag(args, "chrome") ?? config.chrome;
          const storageState =
            stringFlag(args, "storage-state") ??
            process.env.PORTOLAN_STORAGE_STATE ??
            config.storageState;
          const kinds = split("kind");
          const only = split("only");
          const baseUrl = stringFlag(args, "base-url") ?? config.baseUrl;
          const outcome = await (deps.record ?? runRecordGaps)({
            site,
            mapsDir,
            tracesDir: stringFlag(args, "traces-dir") ?? process.env.TRACES_DIR ?? config.traces,
            policiesDir: config.policies,
            ...(kinds !== undefined ? { kinds } : {}),
            ...(only !== undefined ? { only } : {}),
            ...(numberFlag(args, "max") !== undefined ? { max: numberFlag(args, "max") } : {}),
            writes: booleanFlag(args, "writes"),
            ...(baseUrl !== undefined ? { baseUrl } : {}),
            ...(stringFlag(args, "params") !== undefined
              ? { paramsPath: stringFlag(args, "params") }
              : {}),
            ...(chrome !== undefined ? { chrome } : {}),
            ...(storageState !== undefined ? { storageState } : {}),
            headless: booleanFlag(args, "headed") ? false : config.headless,
          });

          const counts = new Map<string, number>();
          for (const item of outcome.outcomes) {
            counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
          }
          out(
            `${site}: ${outcome.outcomes.length} gaps, ${[...counts].map(([status, n]) => `${n} ${status}`).join(", ") || "nothing to record"}`,
          );
          for (const item of outcome.outcomes) {
            if (item.status === "recorded") continue;
            out(
              `  ${item.status.padEnd(14)} ${item.id}${item.detail !== undefined ? ` :: ${item.detail}` : ""}`,
            );
            if (item.affordances !== undefined && item.affordances.length > 0) {
              out(`    saw: ${item.affordances.join("; ")}`);
            }
          }
          out(
            `traces: ${outcome.tracesPath}; next: portolan map build --site ${site} --verify --publish`,
          );
          return 0;
        }

        if (explicit === "coverage") {
          const ledger = readCapabilities(join(mapsDir, site));
          if (ledger === undefined) {
            throw new Error(`no capabilities.json for "${site}" in ${join(mapsDir, site)}`);
          }
          const coverage = coverageOf(ledger);
          if (booleanFlag(args, "json")) {
            out(
              JSON.stringify(
                { coverage, gaps: gapsOf(ledger), unavailable: unavailableOf(ledger), ledger },
                null,
                2,
              ),
            );
          } else {
            out(`${site}: ${formatCoverage(coverage)}`);
            for (const gap of gapsOf(ledger)) {
              out(`  ${gap.status.padEnd(7)} ${gap.id} :: ${gap.reason ?? gap.trigger.name}`);
            }
            const olderThan = stringFlag(args, "older-than");
            if (olderThan !== undefined) {
              const aged = agedOf(ledger, parseAge(olderThan));
              out(`${aged.length} not seen in ${olderThan}:`);
              for (const item of aged) {
                out(`  ${item.id} :: last seen ${item.last_seen ?? "never"}`);
              }
            }
            const unavailable = unavailableOf(ledger);
            if (unavailable.length > 0) {
              out(
                `${unavailable.length} unavailable (disabled in the data the crawl saw): seed data or open from another state to make them testable, or \`map capability set --status excluded --reason ...\``,
              );
              for (const item of unavailable) {
                out(`  unavailable ${item.id} :: ${item.precondition ?? item.trigger.name}`);
              }
            }
          }
          return 0;
        }

        const positional =
          explicit === "build" || update ? args.positional.slice(1) : args.positional;
        const urls = listFlag(args, "url");
        const url = urls[0];
        const baseUrl = stringFlag(args, "base-url") ?? config.baseUrl;
        const traces = [...positional, ...listFlag(args, "trace"), ...listFlag(args, "traces")];
        const routesFrom = stringFlag(args, "routes-from");
        if (
          routesFrom !== undefined &&
          routesFrom !== "react-router" &&
          routesFrom !== "next" &&
          routesFrom !== "sveltekit"
        ) {
          throw new Error('--routes-from must be "react-router", "next", or "sveltekit"');
        }
        const tracesDir =
          stringFlag(args, "traces-dir") ??
          process.env.TRACES_DIR ??
          (url === undefined ? config.traces : undefined);
        const result = await (deps.map ?? runMapBuild)({
          site,
          mapsDir,
          ...(url !== undefined ? { url } : {}),
          ...(urls.length > 1 ? { urls: urls.slice(1) } : {}),
          ...(stringFlag(args, "routes") !== undefined
            ? { routesPath: stringFlag(args, "routes") }
            : {}),
          ...(routesFrom !== undefined ? { routesFrom } : {}),
          ...(stringFlag(args, "src") !== undefined ? { src: stringFlag(args, "src") } : {}),
          explore: booleanFlag(args, "explore"),
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(traces.length > 0 ? { traces } : {}),
          // The configured default only applies to a traces-only build; with
          // --url, a directory is read only when it was asked for.
          ...(tracesDir !== undefined ? { tracesDir } : {}),
          ...(stringFlag(args, "params") !== undefined
            ? { paramsPath: stringFlag(args, "params") }
            : {}),
          ...(stringFlag(args, "outcome-checks") !== undefined
            ? { outcomeChecksPath: stringFlag(args, "outcome-checks") }
            : {}),
          ...(numberFlag(args, "max-pages") !== undefined
            ? { maxPages: numberFlag(args, "max-pages") }
            : {}),
          update,
          ...(listFlag(args, "state").length > 0 ? { states: listFlag(args, "state") } : {}),
          verify: booleanFlag(args, "verify"),
          verifyWrites: booleanFlag(args, "verify-writes"),
          publish: booleanFlag(args, "publish"),
          requireComplete: booleanFlag(args, "require-complete"),
          strict: booleanFlag(args, "strict"),
          allowCost: booleanFlag(args, "allow-cost"),
          noDedupe: booleanFlag(args, "no-dedupe"),
          reverify: booleanFlag(args, "reverify"),
          noInferPost: booleanFlag(args, "no-infer-post"),
          requirePost: booleanFlag(args, "require-post"),
          ...(numberFlag(args, "concurrency") !== undefined
            ? { concurrency: numberFlag(args, "concurrency") }
            : {}),
          ...(stringFlag(args, "app-version") !== undefined
            ? { appVersion: stringFlag(args, "app-version") }
            : {}),
          ...(listFlag(args, "exclude").length > 0 ? { exclude: listFlag(args, "exclude") } : {}),
          ...(stringFlag(args, "start") !== undefined
            ? { start: stringFlag(args, "start") }
            : config.start !== undefined
              ? { start: config.start }
              : {}),
          ...(stringFlag(args, "chrome") !== undefined
            ? { chrome: stringFlag(args, "chrome") }
            : config.chrome !== undefined
              ? { chrome: config.chrome }
              : {}),
          headless: booleanFlag(args, "headed") ? false : config.headless,
          policiesDir: config.policies,
          ...(stringFlag(args, "storage-state") !== undefined
            ? { storageState: stringFlag(args, "storage-state") }
            : process.env.PORTOLAN_STORAGE_STATE !== undefined
              ? { storageState: process.env.PORTOLAN_STORAGE_STATE }
              : config.storageState !== undefined
                ? { storageState: config.storageState }
                : {}),
        });

        out(
          `drafted ${result.draft.proposals.length} ops, ${result.draft.tasks.length} tasks at ${result.draftPath}`,
        );
        const blocked = blockedHosts(result.draft.tasks.map((task) => task.message));
        if (blocked.length > 0) {
          out(
            `egress blocked ${blocked.join(", ")}; allow with: portolan policy allow --site ${site} ${blocked.join(" ")}`,
          );
        }
        const unreached = result.discovery?.unreached;
        if (unreached !== undefined && unreached.length > 0) {
          out(
            `${unreached.length} routes not reached: ${unreached.slice(0, 10).join(", ")}${unreached.length > 10 ? ", ..." : ""}`,
          );
          out("  add --url entry points, --explore, or --params to reach them");
        }
        const cut = result.discovery?.truncated;
        if (cut !== undefined) {
          out(
            cut.limit === "max-pages"
              ? `crawl stopped at --max-pages ${cut.value} with ${cut.queued} URLs queued; rerun with --max-pages ${cut.value + cut.queued}`
              : `crawl stopped at the ${cut.value}-op limit with ${cut.queued} URLs queued; exclude pages or build in parts`,
          );
        }
        out(`capabilities: ${formatCoverage(result.coverage)}`);
        out(`  ${result.capabilitiesPath}`);
        if (result.verified.length > 0) out(`verified ${result.verified.join(", ")}`);
        if (result.published !== undefined) {
          out(`published v${result.published.version} at ${result.published.path}`);
        } else if (!booleanFlag(args, "publish")) {
          out("not published; rerun with --verify --publish");
        } else {
          out("nothing to publish: no new or changed ops since the published map");
        }
        return 0;
      }

      case "policy": {
        const sub = args.positional[0];
        if (sub !== "allow") throw new Error('policy expects "allow"');
        const config = loadConfig(stringFlag(args, "config"));
        const site = stringFlag(args, "site") ?? config.site;
        const result = runPolicyAllow({
          site,
          policiesDir: config.policies,
          hosts: args.positional.slice(1),
        });
        out(
          result.added.length === 0
            ? `${site}: already allowed`
            : `${site}: allowed ${result.added.join(", ")}`,
        );
        out(`  ${result.path}`);
        return 0;
      }

      case "compile": {
        const config = loadConfig(stringFlag(args, "config"));
        const mapPath = required(args, "map");
        const traces = [...args.positional, ...listFlag(args, "trace")];
        const baseUrl = stringFlag(args, "base-url") ?? config.baseUrl;
        const outcomeChecksPath = stringFlag(args, "outcome-checks");
        const chrome = stringFlag(args, "chrome") ?? config.chrome;
        const compileStorageState =
          stringFlag(args, "storage-state") ??
          process.env.PORTOLAN_STORAGE_STATE ??
          config.storageState;
        const result = await (deps.compile ?? runCompile)({
          mapPath,
          tracePaths: traces,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(outcomeChecksPath !== undefined ? { outcomeChecksPath } : {}),
          ...(stringFlag(args, "params") !== undefined
            ? { paramsPath: stringFlag(args, "params") }
            : {}),
          verifyWrites: booleanFlag(args, "verify-writes"),
          ...(chrome !== undefined ? { chrome } : {}),
          ...(compileStorageState !== undefined ? { storageState: compileStorageState } : {}),
          headless: booleanFlag(args, "headed") ? false : config.headless,
        });
        out(
          `published v${result.published.version} at ${result.published.path} (${result.candidates.length} candidates)`,
        );
        for (const report of result.reports) {
          out(
            `${report.verified ? "ok  " : "FAIL"} ${report.op}${report.reason !== undefined ? ` — ${report.reason}` : ""}`,
          );
        }
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
        const storageState =
          stringFlag(args, "storage-state") ??
          process.env.PORTOLAN_STORAGE_STATE ??
          config.storageState;
        const result = await (deps.verify ?? runVerify)({
          mapPath: required(args, "map"),
          paramsPath: required(args, "params"),
          ...(ops.length > 0 ? { ops } : {}),
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(chrome !== undefined ? { executablePath: chrome } : {}),
          ...(storageState !== undefined ? { storageState } : {}),
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

      case "qa": {
        return runQa(rest, { out, err });
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

/** `7d`, `12h`, or `30m` as milliseconds. */
export function parseAge(value: string): number {
  const match = /^(\d+)([dhm])$/.exec(value);
  if (match?.[1] === undefined) throw new Error(`--older-than must look like 7d, 12h, or 30m`);
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2] as "d" | "h" | "m"];
  return Number(match[1]) * unit;
}

function required(args: ReturnType<typeof parseArgs>, name: string): string {
  const value = stringFlag(args, name);
  if (value === undefined || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function installShutdown(
  real: boolean,
  handle: { close: () => Promise<void> },
  options: { stdin?: boolean } = {},
): void {
  if (!real) return;

  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  // A client that exits without signalling closes our stdin. Chrome keeps the
  // event loop alive, so without this the process and its browser are orphaned.
  if (options.stdin === true) process.stdin.once("end", shutdown);
}
