import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendBuild, readBuilds } from "./journal.js";
import { createMappingTools } from "./mapping.js";
import { formatStatus, mapStatus } from "./status.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-status-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project() {
  const dir = tempDir();
  const maps = join(dir, "maps");
  const state = join(dir, "state");
  const traces = join(state, "traces");
  mkdirSync(join(maps, "app"), { recursive: true });
  mkdirSync(traces, { recursive: true });

  const item = (name: string, status: string) => ({
    id: `home.button.${name.toLowerCase()}`,
    page: "home",
    trigger: { kind: "button", name },
    status,
    source: "live",
  });
  writeFileSync(
    join(maps, "app", "capabilities.json"),
    JSON.stringify({
      schema: 1,
      site: "app",
      generated_at: "2026-11-17T00:00:00.000Z",
      capabilities: [item("Export", "missing"), item("Print", "missing"), item("Home", "mapped")],
    }),
  );
  writeFileSync(
    join(traces, "traces.jsonl"),
    `${JSON.stringify({
      scope_id: "s1",
      sid: "x",
      intent: "Click Export on home",
      effect: "read",
      started_at: "2026-11-17T00:00:00.000Z",
      capability: "home.button.export",
      entries: [],
    })}\n`,
  );
  return { dir, maps, state, traces };
}

describe("build journal", () => {
  it("appends one line per build and skips a torn line", () => {
    const dir = tempDir();
    const entry = (site: string) => ({
      at: "2026-11-17T00:00:00.000Z",
      site,
      duration_ms: 5,
      args: {},
      verified: [],
      failed: {},
    });
    appendBuild(dir, entry("a"));
    writeFileSync(join(dir, "builds.jsonl"), '{"torn":', { flag: "a" });
    writeFileSync(join(dir, "builds.jsonl"), "\n", { flag: "a" });
    appendBuild(dir, entry("b"));

    expect(readBuilds(dir).map((build) => build.site)).toEqual(["a", "b"]);
    expect(readBuilds(dir, "b")).toHaveLength(1);
    expect(readBuilds(join(dir, "none"))).toEqual([]);
  });
});

describe("mapStatus", () => {
  it("reports coverage, uncompiled traces, grouped failures, and the next command", async () => {
    const p = project();
    appendBuild(p.state, {
      at: "2026-11-17T01:00:00.000Z",
      site: "app",
      duration_ms: 4000,
      args: {},
      verified: ["open_home"],
      failed: {
        op_a: "op_a did not verify: locator did not resolve",
        op_b: "op_b did not verify: locator did not resolve",
        op_c: "op_c is a write; verify it explicitly with --verify-writes",
      },
    });

    const status = await mapStatus({
      site: "app",
      mapsDir: p.maps,
      tracesDir: p.traces,
      journalDir: p.state,
    });

    expect(status.coverage).toMatchObject({ mapped: 1, missing: 2 });
    expect(status.uncompiled_traces).toEqual([
      { scope_id: "s1", intent: "Click Export on home", capability: "home.button.export" },
    ]);
    expect(status.last_build?.failures[0]).toEqual({
      reason: "locator did not resolve",
      ops: ["op_a", "op_b"],
    });
    expect(status.next.join("\n")).toContain("1 recorded runs not compiled");
    expect(status.next.join("\n")).toContain("map record --gaps");

    const text = formatStatus(status).join("\n");
    expect(text).toContain("2 x locator did not resolve");
  });

  it("points at the first build when nothing exists yet", async () => {
    const dir = tempDir();
    const status = await mapStatus({
      site: "new",
      mapsDir: join(dir, "maps"),
      tracesDir: join(dir, "traces"),
      journalDir: dir,
    }).catch((error: Error) => error);

    // An absent maps directory is an error from the store; a present, empty one is not.
    mkdirSync(join(dir, "maps"), { recursive: true });
    const again = await mapStatus({
      site: "new",
      mapsDir: join(dir, "maps"),
      tracesDir: join(dir, "traces"),
      journalDir: dir,
    });
    expect(status).toBeDefined();
    expect(again.next[0]).toContain("portolan map build --site new --url");
  });
});

describe("mapping tools", () => {
  it("pages the gaps and records a manual exclusion", async () => {
    const p = project();
    const config = {
      maps: p.maps,
      traces: p.traces,
      policies: join(p.dir, "policies"),
      headless: true,
    } as never;
    const tools = createMappingTools(config);

    const page = (await tools.gaps({ site: "app", offset: 0, limit: 1 })) as {
      total: number;
      items: Array<{ id: string }>;
      next_offset?: number;
    };
    expect(page).toMatchObject({ total: 2, next_offset: 1 });
    expect(page.items).toHaveLength(1);

    await tools.setCapability({
      site: "app",
      id: "home.button.print",
      status: "excluded",
      reason: "paper",
    });
    const after = (await tools.gaps({ site: "app", offset: 0, limit: 10 })) as { total: number };
    expect(after.total).toBe(1);
    expect(tools.job("missing")).toBeUndefined();
  });

  it("runs a build in the background and reports the job", async () => {
    const p = project();
    const config = { maps: p.maps, traces: p.traces, policies: "p", headless: true } as never;
    const tools = createMappingTools(config, {
      build: async () =>
        ({
          draft: { proposals: [{}, {}], tasks: [] },
          coverage: {
            mapped: 2,
            missing: 0,
            excluded: 0,
            stale: 0,
            unavailable: 0,
            removed: 0,
            total: 2,
            ratio: 1,
          },
          verified: ["a", "b"],
        }) as never,
    });

    const { job } = tools.startBuild({
      site: "app",
      url: "http://app.test/",
      verify: true,
      publish: false,
      update: false,
    });
    expect(tools.job(job)).toMatchObject({ state: "running" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tools.job(job)).toMatchObject({ state: "done", summary: { verified: 2 } });
  });
});
