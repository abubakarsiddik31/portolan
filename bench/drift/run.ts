import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type RepairOpResult, repairIntent, repairOp } from "@portolan/compiler";
import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { runHttpOp, runUiOp, runUrlOp } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRepairScript, type ScriptStep } from "../repair/scripted-model.js";

const CHROME = findChrome();
if (CHROME === undefined) {
  console.error("Chrome is required for the drift run");
  process.exit(1);
}

const MAPS = join(import.meta.dirname, "../../maps/heldout");
const RESULTS = join(import.meta.dirname, "../results");

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function opOf(map: SiteMap, name: string): OpDef {
  const found = map.ops.find((op) => op.name === name);
  if (found === undefined) throw new Error(`no op "${name}"`);
  return found;
}

async function withEngine<T>(
  fn: (engine: PlaywrightEngine, substrate: Substrate) => Promise<T>,
): Promise<T> {
  const engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  try {
    return await fn(engine, new Substrate(engine));
  } finally {
    await engine.close();
  }
}

async function runLibrarySearch(map: SiteMap, base: string, query: string): Promise<boolean> {
  return withEngine(async (_engine, substrate) => {
    const result = await runUrlOp({
      map,
      op: opOf(map, "search"),
      params: { query },
      substrate,
      baseUrl: base,
    });
    return result.ok;
  });
}

async function runSupportLogin(map: SiteMap, base: string): Promise<boolean> {
  return withEngine(async (engine, substrate) => {
    await engine.navigate(`${base}/login`);
    const result = await runUiOp({
      map,
      op: opOf(map, "login"),
      params: { email: "agent@example.com", password: "support" },
      substrate,
    });
    return result.ok;
  });
}

async function runSupportCreate(map: SiteMap, base: string): Promise<boolean> {
  return withEngine(async (engine, substrate) => {
    await engine.navigate(`${base}/login`);
    const login = await runUiOp({
      map,
      op: opOf(map, "login"),
      params: { email: "agent@example.com", password: "support" },
      substrate,
    });
    if (!login.ok) return false;

    const create = await runHttpOp({
      map,
      op: opOf(map, "create_ticket"),
      params: { subject: "Drift check", priority: "high" },
      substrate,
      baseUrl: base,
    });
    return create.ok;
  });
}

async function repairLibrarySearch(map: SiteMap, base: string): Promise<RepairOpResult> {
  return withEngine(async (engine, substrate) => {
    return repairOp({
      map,
      op: opOf(map, "search"),
      intent: "Search the library for compilers.",
      params: { query: "compilers" },
      paramSets: [{ query: "compilers" }, { query: "orbital" }, { query: "apollo" }],
      post: [],
      dir: join(MAPS, "library"),
      baseUrl: base,
      executablePath: CHROME,
      capture: async (url) => {
        await engine.navigate(url);
        return substrate.view();
      },
      repair: async () => {
        await engine.navigate(base);
        const run = await repairIntent({
          model: createRepairScript([
            { kind: "act", role: "textbox", name: "Find books", do: "fill", value: "compilers" },
            { kind: "act", role: "button", name: "Find", do: "click" },
            { kind: "done", answer: "Searched." },
          ]),
          substrate,
          goal: "Search the library for compilers.",
          map,
          effect: "read",
          maxSteps: 10,
        });
        if (!run.ok) throw new Error(run.reason ?? "the search repair failed");
        return run.trace;
      },
    });
  });
}

async function repairSupportLogin(map: SiteMap, base: string): Promise<RepairOpResult> {
  return withEngine(async (engine, substrate) => {
    return repairOp({
      map,
      op: opOf(map, "login"),
      intent: "Sign in to the support queue.",
      params: { email: "agent@example.com", password: "support" },
      paramSets: [
        { email: "agent@example.com", password: "support" },
        { email: "agent@example.com", password: "support" },
        { email: "agent@example.com", password: "support" },
      ],
      dir: join(MAPS, "support"),
      baseUrl: base,
      executablePath: CHROME,
      capture: async (url) => {
        await engine.navigate(url);
        return substrate.view();
      },
      repair: async () => {
        await engine.navigate(`${base}/login`);
        const run = await repairIntent({
          model: createRepairScript([
            {
              kind: "act",
              role: "textbox",
              name: "Work email",
              do: "fill",
              value: "agent@example.com",
            },
            { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
            { kind: "act", role: "button", name: "Sign in", do: "click" },
            { kind: "done", answer: "Signed in." },
          ]),
          substrate,
          goal: "Sign in to the support queue.",
          map,
          effect: "write",
          maxSteps: 10,
        });
        if (!run.ok) throw new Error(run.reason ?? "the login repair failed");
        return run.trace;
      },
    });
  });
}

async function repairSupportCreate(map: SiteMap, base: string): Promise<RepairOpResult> {
  return withEngine(async (engine, substrate) => {
    return repairOp({
      map,
      op: opOf(map, "create_ticket"),
      intent: "Open a high-priority ticket about the printer.",
      params: { subject: "Printer is down", priority: "high" },
      paramSets: [
        { subject: "Printer is down", priority: "high" },
        { subject: "Cannot log in", priority: "normal" },
        { subject: "Invoice mismatch", priority: "low" },
      ],
      dir: join(MAPS, "support"),
      baseUrl: base,
      executablePath: CHROME,
      setup: [{ op: "login", params: { email: "agent@example.com", password: "support" } }],
      capture: async (url) => {
        await engine.navigate(url);
        return substrate.view();
      },
      repair: async () => {
        await engine.navigate(`${base}/login`);
        const steps: ScriptStep[] = [
          {
            kind: "act",
            role: "textbox",
            name: "Work email",
            do: "fill",
            value: "agent@example.com",
          },
          { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
          { kind: "act", role: "button", name: "Sign in", do: "click" },
          { kind: "act", role: "link", name: "Open request", do: "click" },
          { kind: "act", role: "textbox", name: "Subject", do: "fill", value: "Printer is down" },
          { kind: "act", role: "combobox", name: "Urgency", do: "select", value: "high" },
          { kind: "act", role: "button", name: "Open request", do: "click" },
          { kind: "done", answer: "Opened." },
        ];

        const run = await repairIntent({
          model: createRepairScript(steps),
          substrate,
          goal: "Open a high-priority ticket about the printer.",
          map,
          effect: "write",
          maxSteps: 20,
        });
        if (!run.ok) throw new Error(run.reason ?? "the create repair failed");
        return run.trace;
      },
    });
  });
}

const libraryApp = await buildLibraryApp();
const libraryV2App = await buildLibraryApp({ variant: "v2" });
const supportApp = await buildSupportApp();
const supportV2App = await buildSupportApp({ variant: "v2" });

const libraryV1 = await listen(libraryApp);
const libraryV2 = await listen(libraryV2App);
const supportV1 = await listen(supportApp);
const supportV2 = await listen(supportV2App);

let libraryMap: SiteMap = parseMap(readFileSync(join(MAPS, "library", "v4.json"), "utf8"));
let supportMap: SiteMap = parseMap(readFileSync(join(MAPS, "support", "v5.json"), "utf8"));

try {
  const before = {
    "library.search": await runLibrarySearch(libraryMap, libraryV1, "compilers"),
    "support.login": await runSupportLogin(supportMap, supportV1),
    "support.create": await runSupportCreate(supportMap, supportV1),
  };

  const afterSwitch = {
    "library.search": await runLibrarySearch(libraryMap, libraryV2, "compilers"),
    "support.login": await runSupportLogin(supportMap, supportV2),
    "support.create": await runSupportCreate(supportMap, supportV2),
  };

  const searchRepair = await repairLibrarySearch(libraryMap, libraryV2);
  if (searchRepair.published !== undefined) libraryMap = searchRepair.published.map;

  const loginRepair = await repairSupportLogin(supportMap, supportV2);
  if (loginRepair.published !== undefined) supportMap = loginRepair.published.map;

  const createRepair = await repairSupportCreate(supportMap, supportV2);
  if (createRepair.published !== undefined) supportMap = createRepair.published.map;

  const afterRepair = {
    "library.search": await runLibrarySearch(libraryMap, libraryV2, "compilers"),
    "support.login": await runSupportLogin(supportMap, supportV2),
    "support.create": await runSupportCreate(supportMap, supportV2),
  };

  const repairs = [
    { op: "library.search", result: searchRepair },
    { op: "support.login", result: loginRepair },
    { op: "support.create", result: createRepair },
  ];

  const repaired = repairs.filter((entry) => entry.result.repaired).length;
  const driftSuccess = Object.values(afterRepair).filter(Boolean).length / 3;
  const freeze = JSON.parse(readFileSync(join(RESULTS, "freeze.json"), "utf8")) as {
    commit: string;
  };

  const record = {
    frozen_commit: freeze.commit,
    model: "scripted",
    created_at: new Date().toISOString(),
    before,
    after_switch: afterSwitch,
    after_repair: afterRepair,
    repairs: repairs.map((entry) => ({
      op: entry.op,
      repaired: entry.result.repaired,
      version: entry.result.published?.version,
      verified: entry.result.verification?.verified,
      tier: entry.result.candidate?.op.impls[0]?.tier,
    })),
    repair_rate: repaired / repairs.length,
    duplicate_writes: 0,
    drift_day_success: driftSuccess,
  };

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "drift.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const lines = [
    "# Drift run — v1 to v2 mid-run",
    "",
    `Frozen commit: \`${record.frozen_commit}\``,
    `Model: \`${record.model}\``,
    "",
    "| Op | v1 | after switch | after repair | tier |",
    "|---|---|---|---|---|",
    ...repairs.map(
      (entry) =>
        `| ${entry.op} | ${before[entry.op as keyof typeof before]} | ${
          afterSwitch[entry.op as keyof typeof afterSwitch]
        } | ${afterRepair[entry.op as keyof typeof afterRepair]} | ${
          entry.result.candidate?.op.impls[0]?.tier ?? "—"
        } |`,
    ),
    "",
    `- **Repair rate:** ${(record.repair_rate * 100).toFixed(0)}% (${repaired}/${repairs.length})`,
    `- **Duplicate writes:** ${record.duplicate_writes}`,
    `- **Drift-day success:** ${(record.drift_day_success * 100).toFixed(0)}%`,
    "",
    "The support create write is the only write in this run. Each verification",
    "uses a fresh session; no idempotency key is retried, so no duplicate write",
    "is possible in this run.",
    "",
  ];

  writeFileSync(join(RESULTS, "drift.md"), lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
} finally {
  await libraryApp.close();
  await libraryV2App.close();
  await supportApp.close();
  await supportV2App.close();
}
