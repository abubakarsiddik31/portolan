import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/build-docs.mjs");
const SLUGS = [
  "quickstart",
  "concepts",
  "mcp",
  "skills",
  "write-safety",
  "install",
  "config",
  "map-spec",
  "security",
  "packaging",
  "licensing",
];
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-docs-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("docs site", () => {
  it("builds every page and resolves every internal link", () => {
    const out = tempDir();
    execFileSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });

    const files = new Set(readdirSync(out));
    expect(files.has("index.html")).toBe(true);
    expect(files.has("style.css")).toBe(true);

    for (const slug of SLUGS) {
      expect(files.has(`${slug}.html`), `${slug}.html is missing`).toBe(true);
    }

    for (const file of files) {
      if (!file.endsWith(".html")) continue;
      const html = readFileSync(join(out, file), "utf8");
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");

      for (const href of hrefs) {
        if (href.startsWith("http") || href.startsWith("#")) continue;
        expect(href.endsWith(".md"), `${file} still links to ${href}`).toBe(false);

        const [path] = href.split("#");
        if (path === undefined || path === "") continue;
        expect(existsSync(join(out, path)), `${file} links to missing ${path}`).toBe(true);
      }
    }
  });

  it("the quickstart names the working call and the command", () => {
    const out = tempDir();
    execFileSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });
    const html = readFileSync(join(out, "quickstart.html"), "utf8");

    expect(html).toContain("open_site");
    expect(html).toContain("view");
    expect(html).toContain("doctor");
  });

  it("the landing page links to the first five guides", () => {
    const out = tempDir();
    execFileSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });
    const html = readFileSync(join(out, "index.html"), "utf8");

    for (const slug of SLUGS.slice(0, 5)) {
      expect(html).toContain(`./${slug}.html`);
    }
  });
});
