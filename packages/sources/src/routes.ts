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

/** Which routes each source file defines, so a changed file names the pages it can affect. */
export function routeFiles(
  framework: RouteFramework,
  srcDir: string,
): Array<{ file: string; routes: string[] }> {
  if (!existsSync(srcDir)) throw new Error(`--src ${srcDir} does not exist`);

  return walk(srcDir)
    .map((file) => ({ file, routes: routesOfFile(framework, srcDir, file) }))
    .filter((entry) => entry.routes.length > 0);
}

/** Read the route table from a project's source instead of crawling for it. */
export function mineRoutes(framework: RouteFramework, srcDir: string): string[] {
  return normalizeRoutes(routeFiles(framework, srcDir).flatMap((entry) => entry.routes));
}

function routesOfFile(framework: RouteFramework, srcDir: string, file: string): string[] {
  switch (framework) {
    case "react-router":
      return SOURCE.has(extname(file))
        ? normalizeRoutes(reactRouterPaths(readFileSync(file, "utf8")))
        : [];
    case "next": {
      const parts = relative(srcDir, file).split(sep);
      const root = parts.includes("app") ? "app" : parts.includes("pages") ? "pages" : "";
      if (root === "") return [];
      const rest = parts.slice(parts.indexOf(root) + 1);
      const base = (rest[rest.length - 1] ?? "").replace(/\.[^.]+$/, "");
      if (root === "app" && base !== "page") return [];
      if (root === "pages" && (base.startsWith("_") || rest[0] === "api")) return [];
      const dirs = root === "app" ? rest.slice(0, -1) : [...rest.slice(0, -1), base];
      return normalizeRoutes([fileSegments(dirs)]);
    }
    case "sveltekit": {
      const parts = relative(srcDir, file).split(sep);
      const at = parts.indexOf("routes");
      if (at === -1 || parts[parts.length - 1] !== "+page.svelte") return [];
      return normalizeRoutes([fileSegments(parts.slice(at + 1, -1))]);
    }
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
