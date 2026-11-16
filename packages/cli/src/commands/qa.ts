import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type CaseResult,
  loadQaConfig,
  parseCase,
  type QaConfig,
  QaService,
  qaInit,
  renderJUnit,
  renderMarkdown,
  type Selection,
  startQaMcpServer,
} from "@portolan/qa";

import { booleanFlag, listFlag, numberFlag, parseArgs, stringFlag } from "../args.js";

export const QA_USAGE = `portolan qa <command> [options]

Commands:
  init                   write config, dirs, skill, and harness wiring
  list                   list cases and their status
  plan                   choose cases affected by the git diff
  run                    run cases (deterministic; no model)
  result <run_id>        read a run's typed results
  case read <id>         read one case spec
  case write <file>      validate and write one case (always draft)
  verify                 replay cases and promote verified ones
  sync                   reconcile case files with the local database
  coverage               list routes covered by cases
  report <run_id>        render a run as json, md, or junit
  doctor                 check config, database, and the browser
  mcp                    serve the QA MCP server over stdio
  generate               not implemented yet
  repair                 not implemented yet

Selection: --changed, --suite NAME, --case ID (repeatable), --tag TAG, --all
Common: --json, --config PATH, --repeat N, --allow-unverified, --base-url URL
`;

export type QaCommandDeps = {
  out?: (line: string) => void;
  err?: (line: string) => void;
  createService?: (config: QaConfig) => QaService;
};

export async function runQa(argv: string[], deps: QaCommandDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const [sub, ...rest] = argv;

  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
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
    });

    if (json) {
      out(JSON.stringify(result, null, 2));
      return 0;
    }

    out(`initialized QA in ${result.root}`);
    for (const file of result.files) out(`  wrote ${file}`);
    for (const file of result.skipped) out(`  kept  ${file}`);
    out(`  harness: ${result.harnesses.join(", ")}`);
    out("  MCP entry:");
    for (const line of result.mcpSnippet.trimEnd().split("\n")) out(`    ${line}`);
    out("next: restart your coding harness, then ask it to run qa_plan");
    return 0;
  }

  const loaded = loadQaConfig(stringFlag(args, "config"));
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
        const checks = [
          { name: "config", ok: true, detail: loaded.file ?? "defaults" },
          { name: "cases", ok: existsSync(loaded.config.cases), detail: loaded.config.cases },
          { name: "database", ok: true, detail: service.store.location() },
          { name: "base_url", ok: isUrl(loaded.config.baseUrl), detail: loaded.config.baseUrl },
          {
            name: "browser",
            ok: loaded.config.chrome !== undefined || process.env.CHROME_PATH !== undefined,
            detail: loaded.config.chrome ?? process.env.CHROME_PATH ?? "auto-detect",
          },
          { name: "integrity", ok: service.store.integrity().ok, detail: "sqlite + spec hashes" },
        ];

        if (json) {
          out(JSON.stringify(checks, null, 2));
        } else {
          for (const check of checks)
            out(`${check.ok ? "ok  " : "WARN"} ${check.name}: ${check.detail}`);
        }

        return checks.every((check) => check.ok) ? 0 : 3;
      }

      case "mcp": {
        await startQaMcpServer(service);
        return 0;
      }

      case "generate":
      case "repair": {
        err(`qa ${sub} is not implemented yet; use qa case write and qa verify`);
        return 2;
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
