#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

const byLicense = JSON.parse(raw);

const denied = [];
const unknown = [];
const counts = {};

for (const [expression, packages] of Object.entries(byLicense)) {
  const names = packages.map((pkg) => `${pkg.name}@${pkg.versions.join(",")}`);
  counts[expression] = (counts[expression] ?? 0) + names.length;

  if (expression === "Unknown" || expression === "UNLICENSED") {
    unknown.push(...names);
    continue;
  }

  if (!allowed(expression)) denied.push({ expression, packages: names });
}

console.log("Production dependency licenses:");
for (const [expression, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${expression.padEnd(28)} ${count}`);
}

if (unknown.length > 0) {
  console.log(`\nReview these ${unknown.length} unknown license(s):`);
  for (const name of unknown) console.log(`  ${name}`);
}

if (denied.length > 0) {
  console.error("\nCopyleft in the default path:");
  for (const entry of denied) {
    console.error(`  ${entry.expression}: ${entry.packages.join(", ")}`);
  }
  process.exit(1);
}

console.log("\nNo AGPL, GPL, or SSPL in the production dependency graph.");

/**
 * An expression is allowed when at least one OR branch is free of a denied
 * identifier, and every identifier in that branch passes. This accepts
 * dual-licensed packages such as "(AFL-2.1 OR BSD-3-Clause)".
 */
function allowed(expression) {
  return expression
    .split(/\s+OR\s+/i)
    .some((branch) => branch.split(/\s+AND\s+/i).every((identifier) => !isDenied(identifier)));
}

function isDenied(identifier) {
  const clean = identifier.replace(/[()]/g, "").trim();
  return /^(A?GPL|SSPL)(-|$)/i.test(clean);
}
