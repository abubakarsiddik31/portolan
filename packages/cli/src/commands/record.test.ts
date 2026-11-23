import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SemanticNode, Substrate } from "@abubakarsiddiik/substrate";
import { afterEach, describe, expect, it } from "vitest";

import { runMapBuild } from "./map.js";
import { runRecordGaps } from "./record.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-record-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function node(nodeId: string, name: string, extra: Partial<SemanticNode> = {}): SemanticNode {
  return {
    nodeId,
    role: "button",
    name,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
    ...extra,
  };
}

function fakeSubstrate(buttons: SemanticNode[], clicks: string[]): Substrate {
  const nodes = [node("root", "Home", { role: "RootWebArea" }), ...buttons];
  const snapshot = (path: string) => ({
    doc: 1,
    v: 1,
    url: `http://app.test${path}`,
    title: "Home",
    nodes,
  });
  const refs = {
    byNode: new Map(buttons.map((b) => [b.nodeId, { ref: `r_${b.nodeId}` }])),
    byRef: new Map(
      buttons.map((b) => [`r_${b.nodeId}`, { role: b.role, name: b.name, ordinal: 0 }]),
    ),
  };
  let path = "/";

  return {
    goto: async (url: string) => {
      path = new URL(url).pathname;
      return { snapshot: snapshot(path), refs };
    },
    act: async (request: { ref: string }) => {
      clicks.push(request.ref);
      return {
        ok: true,
        doc: 1,
        v: 2,
        url: `http://app.test${path}?range=30d`,
        title: "Home",
        effects: [],
        delta: { navigation: false, entries: [] },
      };
    },
    read: async () => ({ text: "30 days, peak 2" }),
  } as unknown as Substrate;
}

function ledgerOn(dir: string): string {
  const mapDir = join(dir, "maps", "app");
  mkdirSync(mapDir, { recursive: true });
  const item = (name: string, status = "missing") => ({
    id: `home.button.${name.toLowerCase().replace(/\W+/g, "_")}`,
    page: "home",
    trigger: { kind: "button", name },
    status,
    source: "live",
  });
  writeFileSync(
    join(mapDir, "capabilities.json"),
    JSON.stringify({
      schema: 1,
      site: "app",
      generated_at: "2026-11-17T00:00:00.000Z",
      capabilities: [
        item("30 days"),
        item("Delete account"),
        item("Create key"),
        item("Next"),
        item("Ghost"),
        item("Home", "mapped"),
      ],
    }),
  );
  writeFileSync(
    join(mapDir, "draft.json"),
    JSON.stringify({ origins: ["http://app.test"], states: [{ id: "home", url: "/" }] }),
  );
  return mapDir;
}

describe("map record --gaps", () => {
  it("records one trace per mappable gap, tagged with its capability", async () => {
    const dir = tempDir();
    const mapDir = ledgerOn(dir);
    const clicks: string[] = [];
    const substrate = fakeSubstrate(
      [
        node("a", "30 days"),
        node("b", "Delete account"),
        node("c", "Create key"),
        node("d", "Next", { properties: { disabled: true } }),
        node("e", "Home"),
      ],
      clicks,
    );

    const result = await runRecordGaps(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        tracesDir: join(dir, "traces"),
      },
      { substrate },
    );

    const byId = new Map(result.outcomes.map((outcome) => [outcome.id, outcome]));
    expect(byId.get("home.button.30_days")?.status).toBe("recorded");
    expect(byId.get("home.button.delete_account")).toMatchObject({ status: "skipped" });
    expect(byId.get("home.button.create_key")).toMatchObject({ status: "skipped" });
    expect(byId.get("home.button.next")).toMatchObject({ status: "disabled" });
    expect(byId.get("home.button.ghost")).toMatchObject({ status: "not_found" });
    expect(byId.get("home.button.ghost")?.affordances).toContain('button "30 days"');
    expect(byId.has("home.button.home")).toBe(false);
    expect(clicks).toEqual(["r_a"]);

    const lines = readFileSync(result.tracesPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const trace = JSON.parse(lines[0] ?? "{}");
    expect(trace.capability).toBe("home.button.30_days");
    expect(trace.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "view",
      "act",
      "read",
    ]);

    const ledger = JSON.parse(readFileSync(join(mapDir, "capabilities.json"), "utf8"));
    const next = ledger.capabilities.find((item: { id: string }) => item.id === "home.button.next");
    expect(next).toMatchObject({ status: "unavailable" });
  });

  it("acts on a write-looking control only with --writes, and honors --only and --max", async () => {
    const dir = tempDir();
    ledgerOn(dir);
    const clicks: string[] = [];
    const substrate = fakeSubstrate([node("c", "Create key"), node("a", "30 days")], clicks);

    const result = await runRecordGaps(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        tracesDir: join(dir, "traces"),
        only: ["home.button.create_key"],
        writes: true,
      },
      { substrate },
    );

    expect(result.outcomes).toEqual([{ id: "home.button.create_key", status: "recorded" }]);
    expect(clicks).toEqual(["r_c"]);
  });

  it("makes map build cover exactly the capability a trace was recorded for", async () => {
    const dir = tempDir();
    const mapDir = ledgerOn(dir);
    const tracesDir = join(dir, "traces");
    const substrate = fakeSubstrate([node("a", "30 days")], []);

    await runRecordGaps(
      { site: "app", mapsDir: join(dir, "maps"), tracesDir, only: ["home.button.30_days"] },
      { substrate },
    );

    const traceCount = readFileSync(join(tracesDir, "traces.jsonl"), "utf8")
      .trim()
      .split("\n").length;
    expect(traceCount).toBe(1);
    void mapDir;

    const build = await runMapBuild(
      {
        site: "app",
        mapsDir: join(dir, "maps"),
        tracesDir,
        baseUrl: "http://app.test",
        verify: false,
        verifyWrites: false,
        publish: false,
      },
      {},
    );
    expect(build.draft.proposals[0]?.capability).toBe("home.button.30_days");
  });
});
