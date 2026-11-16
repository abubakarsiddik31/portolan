import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || "docs";

function escapeInline(text) {
  return text.split(/(`[^`]*`)/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/<(?=[A-Za-z])/g, "&lt;");
  }).join("");
}

function processFile(file) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    if (/^```/.test(line.trim())) { inFence = !inFence; return line; }
    if (inFence) return line;
    return escapeInline(line);
  });
  writeFileSync(file, out.join("\n"));
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.vitepress' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(md|mdx)$/.test(name)) processFile(p);
  }
}
walk(root);
console.log("escaped angles in", root);
