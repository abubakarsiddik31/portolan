#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGES = join(ROOT, "packages");
const tarballs = process.argv.includes("--tarballs");

const errors = [];

for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const dir = join(PACKAGES, entry.name);
  const path = join(dir, "package.json");
  if (!existsSync(path)) continue;

  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const name = pkg.name ?? entry.name;
  const fail = (message) => errors.push(`${name}: ${message}`);

  if (pkg.private === true) fail("is private; a published package cannot be");
  if (pkg.license !== "Apache-2.0") fail('license must be "Apache-2.0"');
  if (typeof pkg.description !== "string" || pkg.description.length === 0) {
    fail("description is required");
  }
  if (pkg.publishConfig?.access !== "public") fail('publishConfig.access must be "public"');
  if (pkg.publishConfig?.provenance !== true) fail("publishConfig.provenance must be true");
  if (pkg.engines?.node === undefined) fail("engines.node is required");
  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    fail('files must include "dist"');
  }
  if (pkg.repository?.directory !== `packages/${entry.name}`) {
    fail(`repository.directory must be "packages/${entry.name}"`);
  }
  if (pkg.exports?.["."]?.types === undefined || pkg.exports?.["."]?.import === undefined) {
    fail('exports["."] must have "types" and "import"');
  }
  if (name === "@abubakarsiddiik/portolan" && pkg.bin?.portolan !== "./dist/bin.js") {
    fail('bin.portolan must be "./dist/bin.js"');
  }

  if (!tarballs) continue;

  if (!existsSync(join(dir, "dist"))) {
    fail("dist is missing; run pnpm build before --tarballs");
    continue;
  }

  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--silent"], {
      cwd: dir,
      encoding: "utf8",
    }),
  );

  const files = packed[0]?.files?.map((file) => file.path) ?? [];
  if (!files.some((file) => file.startsWith("dist/"))) fail("tarball has no dist/ files");
  if (files.some((file) => file.startsWith("src/"))) fail("tarball includes src/");
}

const dockerfile = join(ROOT, "Dockerfile");
if (!existsSync(dockerfile)) {
  errors.push("Dockerfile: missing");
} else {
  const docker = readFileSync(dockerfile, "utf8");
  const checks = [
    ["CHROME_PATH", "sets CHROME_PATH"],
    ["PORTOLAN_CHROME_SANDBOX", "exposes the sandbox switch"],
    ["EXPOSE 4200", "exposes 4200"],
    ["ENTRYPOINT", "has an entrypoint"],
    ["pnpm --filter @abubakarsiddiik/portolan deploy", "deploys the CLI"],
  ];
  for (const [needle, label] of checks) {
    if (!docker.includes(needle)) errors.push(`Dockerfile: does not ${label}`);
  }

  const wrapper = join(ROOT, "docker/chromium.sh");
  if (!existsSync(wrapper)) {
    errors.push("docker/chromium.sh: missing");
  } else if (!readFileSync(wrapper, "utf8").includes("/usr/bin/chromium")) {
    errors.push("docker/chromium.sh: does not exec Chromium");
  }
}

const ignore = join(ROOT, ".dockerignore");
if (!existsSync(ignore)) {
  errors.push(".dockerignore: missing");
} else if (!readFileSync(ignore, "utf8").includes("node_modules")) {
  errors.push(".dockerignore: does not exclude node_modules");
}

if (errors.length > 0) {
  console.error("packaging check failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `packaging check passed: ${readdirSync(PACKAGES).length} package dirs, Dockerfile, .dockerignore${
    tarballs ? ", tarballs" : ""
  }`,
);
