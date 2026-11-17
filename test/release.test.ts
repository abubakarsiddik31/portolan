import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/release-dry-run.mjs");
const CONFIG = join(ROOT, ".changeset/config.json");
const SYNTHETIC_CHANGESET = join(ROOT, ".changeset/test-release-dry-run.md");
const BUILT = existsSync(join(ROOT, "packages/protocol/dist"));
const dirs: string[] = [];

const PACKAGE_NAMES = readdirSync(join(ROOT, "packages"))
  .filter((name) => existsSync(join(ROOT, "packages", name, "package.json")))
  .map(
    (name) =>
      JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8")).name as string,
  );

const PACKAGE_COUNT = PACKAGE_NAMES.length;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-release-"));
  dirs.push(dir);
  return dir;
}

function withSyntheticChangeset<T>(fn: () => T): T {
  const body = [
    "---",
    ...PACKAGE_NAMES.map((name) => `"${name}": minor`),
    "---",
    "",
    "Synthetic changeset for the release dry-run test.",
    "",
  ].join("\n");

  writeFileSync(SYNTHETIC_CHANGESET, body, "utf8");
  try {
    return fn();
  } finally {
    rmSync(SYNTHETIC_CHANGESET, { force: true });
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("changesets", () => {
  it("publishes publicly against main and ignores bench", () => {
    const config = JSON.parse(readFileSync(CONFIG, "utf8")) as Record<string, unknown>;

    expect(config).toMatchObject({ access: "public", baseBranch: "main" });
    expect(config.ignore).toContain("@abubakarsiddiik/bench");
  });
});

describe("release dry run", () => {
  it("writes notes and a plan without changing the tree", () => {
    const out = tempDir();

    withSyntheticChangeset(() => {
      execFileSync(process.execPath, [SCRIPT, "--out", out, "--notes-only"], { encoding: "utf8" });
    });

    const notes = readFileSync(join(out, "RELEASE_NOTES.md"), "utf8");
    const plan = JSON.parse(readFileSync(join(out, "release-plan.json"), "utf8")) as {
      releases: Array<{ name: string; nextVersion: string }>;
    };

    expect(notes).toContain("Synthetic changeset for the release dry-run test.");
    expect(notes).toContain("@abubakarsiddiik/portolan");
    expect(plan.releases).toHaveLength(PACKAGE_COUNT);
    expect(plan.releases.every((release) => /^\d+\.\d+\.\d+$/.test(release.nextVersion))).toBe(
      true,
    );
  });

  it("handles a tree with no pending changesets", () => {
    const out = tempDir();

    execFileSync(process.execPath, [SCRIPT, "--out", out, "--notes-only"], { encoding: "utf8" });

    const plan = JSON.parse(readFileSync(join(out, "release-plan.json"), "utf8")) as {
      releases: unknown[];
    };

    expect(plan.releases).toHaveLength(0);
  });

  it.skipIf(!BUILT)(
    "packs a tarball for every package",
    () => {
      const out = tempDir();

      withSyntheticChangeset(() => {
        execFileSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });
      });

      const tarballs = readdirSync(out).filter((file) => file.endsWith(".tgz"));
      expect(tarballs).toHaveLength(PACKAGE_COUNT);
    },
    120_000,
  );
});
