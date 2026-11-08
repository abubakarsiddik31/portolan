#!/usr/bin/env node
import { formatDoctor, runDoctor } from "./doctor.js";

const USAGE = `portolan

Usage:
  portolan doctor [--json]   diagnose the browser, config, providers, and clients
  portolan --help            show this message

Exit codes:
  0  every check passed (warnings allowed)
  1  at least one check failed
  2  unknown command
`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === "doctor") {
    const report = runDoctor();
    if (rest.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatDoctor(report)}\n`);
    }
    return report.ok ? 0 : 1;
  }

  process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
