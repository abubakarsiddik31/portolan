#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHANGESETS = join(ROOT, ".changeset");
const PACKAGES = join(ROOT, "packages");

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? join(ROOT, "artifacts") : args[outFlag + 1];
const notesOnly = args.includes("--notes-only");

if (out === undefined) {
  console.error("--out needs a directory");
  process.exit(2);
}

const changesets = readChangesets();
if (changesets.length === 0) {
  console.warn("no changesets found; writing an empty release plan");
}

const releases = planReleases(changesets);
const notes = renderNotes(changesets, releases);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "RELEASE_NOTES.md"), notes, "utf8");
writeFileSync(
  join(out, "release-plan.json"),
  `${JSON.stringify({ generated_at: new Date().toISOString(), releases, changesets }, null, 2)}\n`,
  "utf8",
);

const artifacts = [];
if (!notesOnly) {
  for (const release of releases) {
    const dir = join(PACKAGES, release.directory);
    if (!existsSync(join(dir, "dist"))) {
      console.error(`${release.name}: dist is missing; run pnpm build first`);
      process.exit(1);
    }

    execFileSync("npm", ["pack", "--pack-destination", out, "--silent"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  for (const file of readdirSync(out)) {
    if (file.endsWith(".tgz")) artifacts.push(file);
  }
}

console.log(`release dry run: ${releases.length} packages, ${changesets.length} changesets`);
console.log(`  notes:     ${join(out, "RELEASE_NOTES.md")}`);
console.log(`  plan:      ${join(out, "release-plan.json")}`);
if (!notesOnly) console.log(`  artifacts: ${artifacts.length} tarballs in ${out}`);

function readChangesets() {
  const files = readdirSync(CHANGESETS)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();

  return files.map((file) => {
    const raw = readFileSync(join(CHANGESETS, file), "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
    if (match === null) throw new Error(`${file}: missing frontmatter`);

    const bumps = {};
    for (const line of (match[1] ?? "").split("\n")) {
      const entry = /^\s*"?([^":]+)"?\s*:\s*(patch|minor|major)\s*$/.exec(line);
      if (entry !== null) bumps[entry[1]] = entry[2];
    }

    return { id: file.replace(/\.md$/, ""), bumps, summary: (match[2] ?? "").trim() };
  });
}

function planReleases(changesets) {
  const plan = new Map();

  for (const changeset of changesets) {
    for (const [name, bump] of Object.entries(changeset.bumps)) {
      const dir = readdirSync(PACKAGES).find((candidate) => {
        const path = join(PACKAGES, candidate, "package.json");
        return existsSync(path) && JSON.parse(readFileSync(path, "utf8")).name === name;
      });
      if (dir === undefined) throw new Error(`${name}: no package directory`);

      const pkg = JSON.parse(readFileSync(join(PACKAGES, dir, "package.json"), "utf8"));
      const current = plan.get(name);
      const nextBump = current === undefined ? bump : higher(current.bump, bump);
      plan.set(name, {
        name,
        directory: dir,
        currentVersion: pkg.version,
        bump: nextBump,
        nextVersion: bumpVersion(pkg.version, nextBump),
      });
    }
  }

  return [...plan.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderNotes(changesets, releases) {
  const lines = [
    "# Portolan release notes (dry run)",
    "",
    `Generated ${new Date().toISOString()} from ${changesets.length} changeset${
      changesets.length === 1 ? "" : "s"
    }.`,
    "",
    "## Versions",
    "",
    "| Package | Current | Bump | Next |",
    "|---|---|---|---|",
  ];

  for (const release of releases) {
    lines.push(
      `| \`${release.name}\` | ${release.currentVersion} | ${release.bump} | ${release.nextVersion} |`,
    );
  }

  lines.push("", "## Changes", "");

  for (const changeset of changesets) {
    const packages = Object.keys(changeset.bumps).join(", ");
    lines.push(`### ${changeset.id}`, "", `Packages: ${packages}`, "", changeset.summary, "");
  }

  return lines.join("\n");
}

function higher(a, b) {
  const order = { patch: 1, minor: 2, major: 3 };
  return order[a] >= order[b] ? a : b;
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
