import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/release-dry-run.mjs");
const CONFIG = join(ROOT, ".changeset/config.json");
const BUILT = existsSync(join(ROOT, "packages/protocol/dist"));
const PACKAGE_COUNT = readdirSync(join(ROOT, "packages")).filter((name) =>
  existsSync(join(ROOT, "packages", name, "package.json")),
).length;
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-release-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("changesets", () => {
  it("publishes publicly against main and ignores bench", () => {
    const config = JSON.parse(readFileSync(CONFIG, "utf8")) as Record<string, unknown>;

    expect(config).toMatchObject({ access: "public", baseBranch: "main" });
    expect(config.ignore).toContain("@portolan/bench");
  });

  it("has an initial minor changeset for every package", () => {
    const raw = readFileSync(join(ROOT, ".changeset/initial-release.md"), "utf8");

    for (const name of [
      "protocol",
      "model",
      "substrate",
      "compiler",
      "runtime",
      "server",
      "skills",
      "cli",
    ]) {
      expect(raw).toContain(`"@portolan/${name}": minor`);
    }
  });
});

describe("release dry run", () => {
  it("writes notes and a plan without changing the tree", () => {
    const out = tempDir();
    execFileSync(process.execPath, [SCRIPT, "--out", out, "--notes-only"], { encoding: "utf8" });

    const notes = readFileSync(join(out, "RELEASE_NOTES.md"), "utf8");
    const plan = JSON.parse(readFileSync(join(out, "release-plan.json"), "utf8")) as {
      releases: Array<{ name: string; nextVersion: string }>;
    };

    expect(notes).toContain("Initial public alpha");
    expect(notes).toContain("@portolan/cli");
    expect(plan.releases).toHaveLength(PACKAGE_COUNT);
    expect(plan.releases.find((release) => release.name === "@portolan/cli")?.nextVersion).toBe(
      "0.1.0",
    );
  });

  it.skipIf(!BUILT)(
    "packs a tarball for every package",
    () => {
      const out = tempDir();
      execFileSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });

      const tarballs = readdirSync(out).filter((file) => file.endsWith(".tgz"));
      expect(tarballs).toHaveLength(PACKAGE_COUNT);
    },
    120_000,
  );
});
