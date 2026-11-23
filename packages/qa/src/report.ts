import type { CaseResult, RunSummary } from "./runner.js";

export type ReportInput = {
  suite?: string;
  runId?: string;
  results: CaseResult[];
  summary?: RunSummary;
};

export function renderMarkdown(input: ReportInput): string {
  const summary = input.summary ?? summarize(input.results);
  const lines: string[] = [];

  lines.push(`# QA run${input.runId === undefined ? "" : ` ${input.runId}`}`);
  lines.push("");
  lines.push(
    `**${summary.pass} pass · ${summary.fail} fail · ${summary.skip} skip · ${summary.error} error${
      (summary.known_failure ?? 0) > 0 ? ` · ${summary.known_failure} known failure` : ""
    }${(summary.fixed ?? 0) > 0 ? ` · ${summary.fixed} fixed` : ""}**`,
  );
  lines.push("");
  lines.push("| Case | Status | Code | Detail | Evidence |");
  lines.push("|---|---|---|---|---|");

  for (const result of input.results) {
    const code = result.fail_code ?? "";
    const detail = (result.fail_reason ?? "").replace(/\|/g, "\\|");
    const evidence = result.evidence_dir ?? "";
    lines.push(`| ${result.case_id} | ${result.status} | ${code} | ${detail} | ${evidence} |`);
  }

  if (input.results.some((result) => result.next !== undefined)) {
    lines.push("");
    lines.push("## Next");
    for (const result of input.results) {
      if (result.next === undefined) continue;
      lines.push(`- ${result.case_id}: ${result.next.join("; ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderJUnit(input: ReportInput): string {
  const summary = input.summary ?? summarize(input.results);
  const suiteName = input.suite ?? "portolan-qa";
  const failures = summary.fail + summary.error;
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuite name="${attr(suiteName)}" tests="${input.results.length}" failures="${failures}" skipped="${summary.skip + (summary.known_failure ?? 0)}">`,
  );

  for (const result of input.results) {
    lines.push(
      `  <testcase classname="${attr(suiteName)}" name="${attr(result.case_id)}" time="${(result.duration_ms / 1000).toFixed(3)}">`,
    );

    if (result.status === "skip" || result.status === "known_failure") {
      lines.push(
        `    <skipped message="${attr(
          result.status === "known_failure"
            ? `known failure: ${result.fail_reason ?? ""}`
            : (result.fail_reason ?? "skipped"),
        )}"/>`,
      );
    } else if (result.status === "fail" || result.status === "error") {
      const message = `${result.fail_code ?? result.status}: ${result.fail_reason ?? ""}`;
      lines.push(`    <failure message="${attr(message)}">${text(message)}</failure>`);
    }

    if (result.evidence_dir !== undefined) {
      lines.push(`    <system-out>${text(result.evidence_dir)}</system-out>`);
    }

    lines.push("  </testcase>");
  }

  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

function summarize(results: CaseResult[]): RunSummary {
  const summary: RunSummary = { pass: 0, fail: 0, skip: 0, error: 0 };
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1;
  return summary;
}

function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
