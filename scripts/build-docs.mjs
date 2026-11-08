#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = "https://github.com/abubakarsiddik31/portolan";

const PAGES = [
  { file: "docs/QUICKSTART.md", slug: "quickstart", title: "Quickstart" },
  { file: "docs/CONCEPTS.md", slug: "concepts", title: "Concepts" },
  { file: "docs/MCP.md", slug: "mcp", title: "MCP" },
  { file: "docs/SKILLS.md", slug: "skills", title: "Skills" },
  { file: "docs/WRITE-SAFETY.md", slug: "write-safety", title: "Write safety" },
  { file: "docs/INSTALL.md", slug: "install", title: "Install" },
  { file: "docs/CONFIG.md", slug: "config", title: "Configuration" },
  { file: "docs/spec/map-v0.md", slug: "map-spec", title: "Map format v0" },
  { file: "docs/SECURITY.md", slug: "security", title: "Security" },
  { file: "docs/PACKAGING.md", slug: "packaging", title: "Packaging" },
];

const LINKS = new Map(
  PAGES.flatMap((page) => [
    [`./${basename(page.file)}`, `${page.slug}.html`],
    [`./${page.file.replace(/^docs\//, "")}`, `${page.slug}.html`],
  ]),
);

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? join(ROOT, "site") : args[outFlag + 1];

if (out === undefined) {
  console.error("--out needs a directory");
  process.exit(2);
}

function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const page of PAGES) {
    const markdown = readFileSync(join(ROOT, page.file), "utf8");
    const html = rewriteLinks(marked.parse(markdown, { async: false }));
    writeFileSync(join(out, `${page.slug}.html`), layout(page.title, html, page.slug), "utf8");
  }

  writeFileSync(join(out, "index.html"), layout("Portolan", landing(), "index"), "utf8");
  writeFileSync(join(out, "style.css"), CSS, "utf8");

  console.log(`docs: wrote ${PAGES.length + 2} files to ${out}`);
}

function rewriteLinks(html) {
  return html.replace(/href="([^"]+)"/g, (match, href) => {
    const [path, hash] = href.split("#");
    const mapped = LINKS.get(path);
    if (mapped !== undefined) return `href="./${mapped}${hash === undefined ? "" : `#${hash}`}"`;

    if (path.startsWith("../") && path.endsWith(".md")) {
      return `href="${REPO}/blob/main/${path.replace(/^\.\.\//, "")}"`;
    }

    return match;
  });
}

function nav(active) {
  return PAGES.map(
    (page) =>
      `<a class="nav-link${page.slug === active ? " active" : ""}" href="./${page.slug}.html">${page.title}</a>`,
  ).join("\n        ");
}

function layout(title, body, active) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Portolan</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <aside>
    <a class="brand" href="./index.html">Portolan</a>
    <nav>
        ${nav(active)}
    </nav>
    <p class="note">Map the web once.<br>Every agent sails it.</p>
  </aside>
  <main>
    <article>
${body}
    </article>
    <footer>
      <a href="${REPO}">Source</a> ·
      <a href="${REPO}/blob/main/LICENSE">Apache-2.0</a> ·
      <a href="${REPO}/issues">Issues</a>
    </footer>
  </main>
</body>
</html>
`;
}

function landing() {
  const cards = PAGES.slice(0, 5)
    .map(
      (page) =>
        `<a class="card" href="./${page.slug}.html"><strong>${page.title}</strong><span>${summary(page.slug)}</span></a>`,
    )
    .join("\n      ");

  return `<h1>Portolan</h1>
<p class="lede">Chart the web once. Every agent sails it.</p>
<p>Portolan turns a website into a map an agent can call: named states and
typed operations like <code>search(query)</code> or <code>add_to_cart(id, qty)</code>,
executed through the cheapest verified path and governed by write safety.</p>
<div class="cards">
      ${cards}
</div>
<h2>Start</h2>
<pre><code>git clone ${REPO}.git
cd portolan
pnpm install &amp;&amp; pnpm build
pnpm --filter @portolan/bench fixtures:store</code></pre>
<p><a href="./quickstart.html">Quickstart →</a></p>`;
}

function summary(slug) {
  switch (slug) {
    case "quickstart":
      return "From a clone to a working MCP call.";
    case "concepts":
      return "Map, state, op, tier, session.";
    case "mcp":
      return "Tools, result shapes, and errors.";
    case "skills":
      return "Knowledge, not execution.";
    case "write-safety":
      return "Confirmation, idempotency, unknown outcomes.";
    default:
      return "";
  }
}

const CSS = `:root {
  --ink: #1b1d1f;
  --muted: #5c6166;
  --paper: #fbfaf7;
  --line: #e4dfd4;
  --accent: #2f5d50;
  --code: #f2efe8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
aside {
  border-right: 1px solid var(--line);
  padding: 28px 22px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.brand {
  display: block;
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
  color: var(--ink);
  text-decoration: none;
  margin-bottom: 22px;
}
nav { display: grid; gap: 2px; }
.nav-link {
  color: var(--muted);
  text-decoration: none;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 0.92rem;
}
.nav-link:hover { background: var(--code); color: var(--ink); }
.nav-link.active { background: var(--accent); color: #fff; }
.note { color: var(--muted); font-size: 0.8rem; margin-top: 26px; }
main { padding: 42px 48px 60px; max-width: 900px; }
article { max-width: 760px; }
h1, h2, h3 { letter-spacing: -0.02em; line-height: 1.2; }
h1 { font-size: 2.1rem; margin-top: 0; }
h2 { margin-top: 2.2rem; border-top: 1px solid var(--line); padding-top: 1.4rem; }
h3 { margin-top: 1.6rem; }
p, li { color: #2c3034; }
a { color: var(--accent); }
code {
  background: var(--code);
  padding: 0.12em 0.35em;
  border-radius: 4px;
  font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace;
}
pre {
  background: var(--code);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: 0.94rem; }
th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: var(--code); }
blockquote { border-left: 3px solid var(--line); margin-left: 0; padding-left: 16px; color: var(--muted); }
.lede { font-size: 1.2rem; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin: 26px 0; }
.card {
  display: grid;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 14px 16px;
  text-decoration: none;
  color: var(--ink);
  background: #fff;
}
.card:hover { border-color: var(--accent); }
.card span { color: var(--muted); font-size: 0.88rem; }
footer { margin-top: 60px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
footer a { color: var(--muted); }
@media (max-width: 760px) {
  body { grid-template-columns: 1fr; }
  aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  nav { grid-template-columns: repeat(2, 1fr); }
  main { padding: 26px 22px 50px; }
}
`;

main();
