import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type CaseResult,
  loadQaConfig,
  parseCase,
  QA_MCP_CLI,
  type QaConfig,
  QaService,
  qaInit,
  renderJUnit,
  renderMarkdown,
  type Selection,
  startQaMcpServer,
} from "@abubakarsiddiik/qa";

import { booleanFlag, listFlag, numberFlag, parseArgs, stringFlag } from "../args.js";

export const QA_USAGE = `portolan qa <command> [options]

Commands:
  init                   write .portolan/config.json, dirs, and the skill
                         (--mcp writes or merges the root .mcp.json)
  list                   list cases and their status
  plan                   choose cases affected by the git diff
  run                    run cases (deterministic; no model)
  result <run_id>        read a run's typed results
  case read <id>         read one case spec
  case write <file>      validate and write one case (always draft)
  generate              turn a spec or a recorded trace into a draft case
  repair <case_id>       recover a broken locator and rewrite the case (draft)
  verify                 replay cases and promote verified ones
  sync                   reconcile case files with the local database
  coverage               list routes covered by cases
  report <run_id>        render a run as json, md, or junit
  doctor                 check config, database, and the browser
  mcp                    serve the QA MCP server over stdio

Selection: --changed, --suite NAME, --case ID (repeatable), --tag TAG, --all
Common: --json, --config PATH, --repeat N, --allow-unverified, --base-url URL
Environment: --env NAME [--as PROFILE] on run, verify, and repair runs against a
named environment from .portolan/config.json with its saved session
(sign in once: portolan auth login --env NAME --profile PROFILE)
`;

export type QaCommandDeps = {
  out?: (line: string) => void;
  err?: (line: string) => void;
  createService?: (config: QaConfig) => QaService;
};

type QaDoctorCheck = {
  name: string;
  status: "ok" | "info" | "warn";
  ok: boolean;
  detail: string;
  fix?: string;
};

export async function runQa(argv: string[], deps: QaCommandDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const [sub, ...rest] = argv;

  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    out(QA_USAGE);
    return 0;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    out(QA_USAGE);
    return 0;
  }

  const args = parseArgs(rest);
  const json = booleanFlag(args, "json");

  if (sub === "init") {
    const root = stringFlag(args, "dir") ?? process.cwd();
    const baseUrl = stringFlag(args, "base-url");
    const result = qaInit({
      root,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      force: booleanFlag(args, "force"),
      mcp: booleanFlag(args, "mcp"),
      mcpCommand: QA_MCP_CLI,
    });

    if (json) {
      out(JSON.stringify(result, null, 2));
      return 0;
    }

    out(`initialized QA in ${result.root}`);
    for (const file of result.files) out(`  wrote ${file}`);
    for (const file of result.skipped) out(`  kept  ${file}`);
    out(`  harness: ${result.harnesses.join(", ")}`);
    out(
      result.mcpWritten
        ? `  MCP entry written or merged into ${result.mcpPath}`
        : `  MCP entry for ${result.mcpPath} (pass --mcp to write it):`,
    );
    for (const line of result.mcpSnippet.trimEnd().split("\n")) out(`    ${line}`);
    out(
      "next: read .portolan/skills/portolan-qa/SKILL.md, restart your coding harness, then run qa_plan",
    );
    return 0;
  }

  const loaded = loadQaConfig(stringFlag(args, "config"), process.env, { warn: err });
  const service = (deps.createService ?? ((config) => new QaService(config)))(loaded.config);

  try {
    switch (sub) {
      case "list": {
        const rows = service.list({
          ...(stringFlag(args, "suite") !== undefined ? { suite: stringFlag(args, "suite") } : {}),
          ...(stringFlag(args, "tag") !== undefined ? { tag: stringFlag(args, "tag") } : {}),
          ...(stringFlag(args, "status") !== undefined
            ? { status: stringFlag(args, "status") }
            : {}),
        });

        if (json) {
          out(JSON.stringify(rows, null, 2));
          return 0;
        }

        for (const row of rows) out(`${row.status.padEnd(11)} ${row.id}  ${row.title}`);
        return 0;
      }

      case "plan": {
        const selection: Selection = {
          changed: true,
          ...(numberFlag(args, "max") !== undefined ? { max: numberFlag(args, "max") } : {}),
          ...(booleanFlag(args, "include-quarantined") ? { includeQuarantined: true } : {}),
        };
        const resolved = service.select(selection);

        if (json) {
          out(
            JSON.stringify(
              {
                cases: resolved.cases.map((item) => item.id),
                unverified: resolved.unverified,
                plan: resolved.plan,
              },
              null,
              2,
            ),
          );
          return 0;
        }

        if (resolved.cases.length === 0) {
          out("no cases selected by the current diff");
          return 0;
        }

        for (const item of resolved.plan?.reasons ?? []) {
          if (item.selected) out(`run  ${item.id}  (${item.reasons.join(", ")})`);
        }
        if (resolved.unverified.length > 0) {
          out(`unverified: ${resolved.unverified.join(", ")}`);
        }
        for (const omitted of resolved.plan?.omitted ?? []) out(`omitted by cap: ${omitted}`);
        return 0;
      }

      case "run": {
        const selection = selectionFrom(args);
        if (
          selection.changed !== true &&
          selection.suite === undefined &&
          selection.ids === undefined &&
          selection.tags === undefined &&
          !booleanFlag(args, "all")
        ) {
          err("choose --changed, --suite, --case, --tag, or --all");
          return 2;
        }

        const result = await service.run(selection, {
          ...(numberFlag(args, "repeat") !== undefined
            ? { repeat: numberFlag(args, "repeat") }
            : {}),
          allowUnverified: booleanFlag(args, "allow-unverified"),
          ...envFlags(args),
          ...(stringFlag(args, "evidence") !== undefined
            ? { evidence: stringFlag(args, "evidence") as "failures" | "all" | "none" }
            : {}),
        });

        const reporter = stringFlag(args, "reporter") ?? (json ? "json" : "md");
        const rendered =
          reporter === "junit"
            ? renderJUnit({ runId: result.run_id, results: result.results })
            : reporter === "json"
              ? JSON.stringify(result, null, 2)
              : renderMarkdown({ runId: result.run_id, results: result.results });

        const target = stringFlag(args, "out");
        if (target !== undefined) writeFileSync(target, rendered, "utf8");
        else out(rendered);

        return result.summary.fail > 0 || result.summary.error > 0 ? 1 : 0;
      }

      case "result": {
        const runId = rest[0] ?? stringFlag(args, "run");
        if (runId === undefined) {
          err("usage: portolan qa result <run_id>");
          return 2;
        }

        const report = service.getRun(runId);
        if (report === undefined) {
          err(`no run "${runId}"`);
          return 2;
        }

        if (json) {
          out(JSON.stringify(report, null, 2));
          return 0;
        }

        out(
          `${report.run.status}  ${report.summary.pass} pass · ${report.summary.fail} fail · ${report.summary.skip} skip · ${report.summary.error} error`,
        );
        for (const item of report.cases) {
          out(
            `${item.status.padEnd(5)} ${item.case_id} ${item.fail_code ?? ""} ${item.fail_reason ?? ""}`,
          );
        }
        return report.summary.fail > 0 || report.summary.error > 0 ? 1 : 0;
      }

      case "case": {
        const action = rest[0];
        const value = rest[1];

        if (action === "read" && value !== undefined) {
          const found = service.caseRead(value);
          out(json ? JSON.stringify(found, null, 2) : JSON.stringify(found.spec, null, 2));
          return 0;
        }

        if (action === "write" && value !== undefined) {
          const raw = JSON.parse(readFileSync(resolve(value), "utf8")) as unknown;
          const spec = parseCase(raw);
          const result = service.caseWrite(spec);
          out(json ? JSON.stringify(result, null, 2) : `wrote ${result.path} (draft)`);
          return 0;
        }

        err("usage: portolan qa case read <id> | case write <file>");
        return 2;
      }

      case "verify": {
        const reports = await service.verify(selectionFrom(args), {
          ...(numberFlag(args, "repeat") !== undefined
            ? { repeat: numberFlag(args, "repeat") }
            : {}),
          ...envFlags(args),
        });

        if (json) {
          out(JSON.stringify(reports, null, 2));
        } else {
          for (const report of reports) {
            out(
              `${report.verified ? "verified" : "FAILED  "} ${report.case_id} (${report.runs} runs)${
                report.reason === undefined ? "" : ` — ${report.reason}`
              }`,
            );
          }
        }

        return reports.some((report) => !report.verified) ? 1 : 0;
      }

      case "sync": {
        const report = service.sync();
        out(
          json
            ? JSON.stringify(report, null, 2)
            : `cases ${report.cases}, suites ${report.suites}, added ${report.added.length}, changed ${report.changed.length}, orphaned ${report.orphaned.length}`,
        );
        return 0;
      }

      case "coverage": {
        const coverage = service.coverage();
        out(
          json
            ? JSON.stringify(coverage, null, 2)
            : coverage.map((item) => `${item.key}  ${item.covered_by.join(", ")}`).join("\n"),
        );
        return 0;
      }

      case "report": {
        const runId = rest[0] ?? stringFlag(args, "run");
        if (runId === undefined) {
          err("usage: portolan qa report <run_id> --format md|json|junit");
          return 2;
        }

        const report = service.getRun(runId);
        if (report === undefined) {
          err(`no run "${runId}"`);
          return 2;
        }

        const results: CaseResult[] = report.cases.map((item) => ({
          case_id: item.case_id,
          status: item.status as CaseResult["status"],
          attempt: item.attempt,
          duration_ms: item.duration_ms ?? 0,
          ...(item.fail_code !== null
            ? { fail_code: item.fail_code as CaseResult["fail_code"] }
            : {}),
          ...(item.fail_reason !== null ? { fail_reason: item.fail_reason } : {}),
          ...(item.fail_step !== null ? { fail_step: item.fail_step } : {}),
          ...(item.evidence_dir !== null ? { evidence_dir: item.evidence_dir } : {}),
        }));

        const format = stringFlag(args, "format") ?? "md";
        const rendered =
          format === "json"
            ? JSON.stringify(report, null, 2)
            : format === "junit"
              ? renderJUnit({ runId, results, summary: report.summary })
              : renderMarkdown({ runId, results, summary: report.summary });

        const target = stringFlag(args, "out");
        if (target !== undefined) writeFileSync(target, rendered, "utf8");
        else out(rendered);
        return 0;
      }

      case "doctor": {
        const browserPinned =
          loaded.config.chrome !== undefined || process.env.CHROME_PATH !== undefined;
        const integrity = service.store.integrity();
        const checks: QaDoctorCheck[] = [
          {
            name: "config",
            status: loaded.legacy === undefined ? "ok" : "warn",
            ok: loaded.legacy === undefined,
            detail: loaded.file ?? "defaults (.portolan/config.json)",
            ...(loaded.legacy !== undefined
              ? { fix: `run portolan migrate (move it to ${loaded.legacy.replacement})` }
              : {}),
          },
          {
            name: "cases",
            status: existsSync(loaded.config.cases) ? "ok" : "warn",
            ok: existsSync(loaded.config.cases),
            detail: loaded.config.cases,
            ...(existsSync(loaded.config.cases)
              ? {}
              : { fix: "run portolan qa init (or portolan migrate), then rerun" }),
          },
          { name: "database", status: "ok", ok: true, detail: service.store.location() },
          {
            name: "base_url",
            status: isUrl(loaded.config.baseUrl) ? "ok" : "warn",
            ok: isUrl(loaded.config.baseUrl),
            detail: loaded.config.baseUrl,
            ...(isUrl(loaded.config.baseUrl)
              ? {}
              : { fix: "set qa.baseUrl in .portolan/config.json or QA_BASE_URL" }),
          },
          {
            name: "browser",
            status: browserPinned ? "ok" : "info",
            ok: true,
            detail: loaded.config.chrome ?? process.env.CHROME_PATH ?? "auto-detect",
            ...(browserPinned
              ? {}
              : { fix: "set chrome in config or CHROME_PATH to pin a specific binary" }),
          },
          {
            name: "integrity",
            status: integrity.ok ? "info" : "warn",
            ok: integrity.ok,
            detail: integrity.ok
              ? "sqlite + spec hashes (nothing to do)"
              : "sqlite or spec hashes differ",
            ...(integrity.ok ? {} : { fix: "run portolan qa sync, then rerun" }),
          },
        ];

        if (json) {
          out(JSON.stringify(checks, null, 2));
        } else {
          for (const check of checks) {
            const label = check.status === "warn" ? "WARN" : check.status;
            out(`${label.padEnd(4)} ${check.name}: ${check.detail}`);
            if (check.fix !== undefined && !check.ok) out(`     → ${check.fix}`);
          }
        }

        return checks.every((check) => check.ok) ? 0 : 3;
      }

      case "mcp": {
        await startQaMcpServer(service);
        return 0;
      }

      case "generate": {
        const fromTrace = stringFlag(args, "from-trace");
        const specFile = stringFlag(args, "spec");
        const map = stringFlag(args, "map");

        if (fromTrace === undefined && specFile === undefined) {
          err(
            "usage: portolan qa generate --from-trace PATH | --spec FILE [--id ID] [--suite S] [--title T] [--map site/version/op]",
          );
          return 2;
        }

        let mapSpec: { site: string; version: number; op: string } | undefined;
        if (map !== undefined) {
          const parts = map.split("/");
          const version = Number(parts[1]);
          if (
            parts.length !== 3 ||
            parts[0] === "" ||
            parts[2] === "" ||
            !Number.isInteger(version) ||
            version < 1
          ) {
            err(`--map must look like site/version/op, got "${map}"`);
            return 2;
          }
          mapSpec = { site: parts[0] ?? "", version, op: parts[2] ?? "" };
        }

        const report = service.generate(
          {
            ...(fromTrace !== undefined ? { fromTracePath: resolve(fromTrace) } : {}),
            ...(specFile !== undefined
              ? { fromSpec: JSON.parse(readFileSync(resolve(specFile), "utf8")) }
              : {}),
          },
          {
            ...(stringFlag(args, "id") !== undefined ? { id: stringFlag(args, "id") } : {}),
            ...(stringFlag(args, "suite") !== undefined
              ? { suite: stringFlag(args, "suite") }
              : {}),
            ...(stringFlag(args, "title") !== undefined
              ? { title: stringFlag(args, "title") }
              : {}),
            ...(mapSpec !== undefined ? { map: mapSpec } : {}),
          },
        );

        if (json) {
          out(JSON.stringify(report, null, 2));
          return 0;
        }

        out(`generated ${report.case_id} → ${report.path} (draft)`);
        for (const warning of report.warnings) out(`  warning: ${warning}`);
        for (const next of report.next) out(`  next: ${next}`);
        return 0;
      }

      case "repair": {
        const caseId = args.positional[0];
        if (caseId === undefined) {
          err("usage: portolan qa repair <case_id> [--from-run RUN]");
          return 2;
        }

        const report = await service.repair({
          caseId,
          ...(stringFlag(args, "from-run") !== undefined
            ? { fromRun: stringFlag(args, "from-run") }
            : {}),
          ...envFlags(args),
        });

        if (json) {
          out(JSON.stringify(report, null, 2));
        } else {
          out(`${report.repaired ? "repaired" : "REFUSED "} ${report.case_id} — ${report.reason}`);
          for (const change of report.changes) {
            out(
              `  ${change.phase} ${change.index}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`,
            );
          }
          if (report.confirmation !== undefined) {
            out(
              `  confirmation: ${report.confirmation.status}${report.confirmation.fail_code === undefined ? "" : ` (${report.confirmation.fail_code})`}`,
            );
          }
          for (const next of report.next) out(`  next: ${next}`);
        }

        return report.repaired && report.confirmation?.status === "pass" ? 0 : 1;
      }

      default: {
        err(`unknown qa command "${sub}"`);
        out(QA_USAGE);
        return 2;
      }
    }
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    if (sub !== "mcp") service.close();
  }
}

function selectionFrom(args: ReturnType<typeof parseArgs>): Selection {
  const ids = listFlag(args, "case");
  const tags = listFlag(args, "tag");
  const suite = stringFlag(args, "suite");

  return {
    ...(booleanFlag(args, "changed") ? { changed: true } : {}),
    ...(suite !== undefined ? { suite } : {}),
    ...(ids.length > 0 ? { ids } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function envFlags(args: ReturnType<typeof parseArgs>): { env?: string; as?: string } {
  const env = stringFlag(args, "env");
  const as = stringFlag(args, "as");
  return { ...(env !== undefined ? { env } : {}), ...(as !== undefined ? { as } : {}) };
}
