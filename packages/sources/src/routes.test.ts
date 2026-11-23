import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { mineRoutes, readRoutesFile, routeShape } from "./routes.js";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-routes-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("routes", () => {
  it("reads a routes file as lines or JSON", () => {
    const dir = project({
      "routes.txt": "# app\n/admin\n/orgs/:id/\n\n*\n",
      "routes.json": '["/a", "b"]',
    });

    expect(readRoutesFile(join(dir, "routes.txt"))).toEqual(["/admin", "/orgs/:id"]);
    expect(readRoutesFile(join(dir, "routes.json"))).toEqual(["/a", "/b"]);
  });

  it("mines react-router paths from JSX and route objects", () => {
    const dir = project({
      "App.tsx": `<Route path="/admin" element={<A />} />
        <Route path='/app/kb/:id/files' element={<B />} />
        <Route path="*" element={<NotFound />} />`,
      "router.ts": `export const routes = [{ path: "/profile", element: x }];`,
      "node_modules/dep/index.js": `path: "/ignored"`,
    });

    expect(mineRoutes("react-router", dir)).toEqual(["/admin", "/app/kb/:id/files", "/profile"]);
  });

  it("mines next app and pages directories, and sveltekit routes", () => {
    const next = project({
      "app/page.tsx": "",
      "app/(marketing)/pricing/page.tsx": "",
      "app/orgs/[id]/page.tsx": "",
      "app/orgs/[id]/layout.tsx": "",
      "pages/blog/[slug].tsx": "",
      "pages/api/hello.ts": "",
      "pages/_app.tsx": "",
    });
    expect(mineRoutes("next", next)).toEqual(["/", "/blog/:slug", "/orgs/:id", "/pricing"]);

    const kit = project({
      "src/routes/+page.svelte": "",
      "src/routes/docs/[page]/+page.svelte": "",
      "src/routes/docs/+layout.svelte": "",
    });
    expect(mineRoutes("sveltekit", kit)).toEqual(["/", "/docs/:page"]);
  });

  it("compares routes by shape, not parameter name", () => {
    expect(routeShape("/orgs/:orgId/keys")).toBe(routeShape("/orgs/:id/keys"));
    expect(routeShape("/orgs")).not.toBe(routeShape("/orgs/:id"));
  });
});
