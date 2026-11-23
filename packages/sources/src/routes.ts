import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export type RouteFramework = "react-router" | "next" | "sveltekit";

const SOURCE = new Set([".tsx", ".jsx", ".ts", ".js"]);
const SKIP = new Set(["node_modules", "dist", "build", ".next", ".git", ".svelte-kit"]);

/**
 * Routes a map should know about, as path patterns like `/orgs/:id`.
 *
 * A file lists them one per line (blank lines and `#` comments allowed), or a
 * JSON array of strings.
 */
export function readRoutesFile(path: string): string[] {
  const text = readFileSync(path, "utf8").trim();
  const list = text.startsWith("[")
    ? (JSON.parse(text) as unknown[]).map(String)
    : text.split("\n").filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"));
  return normalizeRoutes(list);
}

/** Read the route table from a project's source instead of crawling for it. */
export function mineRoutes(framework: RouteFramework, srcDir: string): string[] {
  if (!existsSync(srcDir)) throw new Error(`--src ${srcDir} does not exist`);
  const files = walk(srcDir);

  switch (framework) {
    case "react-router":
      return normalizeRoutes(
        files
          .filter((file) => SOURCE.has(extname(file)))
          .flatMap((file) => reactRouterPaths(readFileSync(file, "utf8"))),
      );
    case "next":
      return normalizeRoutes(
        files.flatMap((file) => {
          const parts = relative(srcDir, file).split(sep);
          const root =
            parts.indexOf("app") !== -1 ? "app" : parts.indexOf("pages") !== -1 ? "pages" : "";
          if (root === "") return [];
          const rest = parts.slice(parts.indexOf(root) + 1);
          const name = rest[rest.length - 1] ?? "";
          const base = name.replace(/\.[^.]+$/, "");
          if (root === "app" && base !== "page") return [];
          if (root === "pages" && (base.startsWith("_") || rest[0] === "api")) return [];
          const dirs = root === "app" ? rest.slice(0, -1) : [...rest.slice(0, -1), base];
          return [fileSegments(dirs)];
        }),
      );
    case "sveltekit":
      return normalizeRoutes(
        files.flatMap((file) => {
          const parts = relative(srcDir, file).split(sep);
          const at = parts.indexOf("routes");
          if (at === -1 || parts[parts.length - 1] !== "+page.svelte") return [];
          return [fileSegments(parts.slice(at + 1, -1))];
        }),
      );
  }
}

function fileSegments(dirs: string[]): string {
  const segments = dirs
    .filter((dir) => !/^\(.*\)$/.test(dir) && dir !== "index")
    .map((dir) => dir.replace(/^\[\.\.\.(\w+)\]$/, ":$1").replace(/^\[(\w+)\]$/, ":$1"));
  return `/${segments.join("/")}`;
}

function reactRouterPaths(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bpath\s*(?:=\s*|:\s*)\{?\s*["'`]([^"'`]+)["'`]/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function normalizeRoutes(routes: string[]): string[] {
  const out = new Set<string>();
  for (const raw of routes) {
    const route = raw.trim();
    if (route.length === 0 || route === "*" || route.includes("*")) continue;
    const path = route.startsWith("/") ? route : `/${route}`;
    out.add(path.length > 1 ? path.replace(/\/+$/, "") : path);
  }
  return [...out].sort();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** `/orgs/:orgId` and `/orgs/:id` are the same route. */
export function routeShape(route: string): string {
  return route.replace(/:[A-Za-z0-9_]+/g, ":");
}
