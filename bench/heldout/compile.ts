import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { repairIntent, repairOp } from "@portolan/compiler";
import { type OpDef, parseMap, type SiteMap } from "@portolan/protocol";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";

import { buildLibraryApp } from "../fixtures/library/v1/app.js";
import { buildSupportApp } from "../fixtures/support/v1/app.js";
import { createRepairScript, type ScriptStep } from "../repair/scripted-model.js";

const CHROME = findChrome();
if (CHROME === undefined) {
  console.error("Chrome is required to compile the held-out maps");
  process.exit(1);
}

const MAPS = join(import.meta.dirname, "../../maps/heldout");
const RESULTS = join(import.meta.dirname, "../results");

async function listen(app: Awaited<ReturnType<typeof buildLibraryApp>>): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

const libraryApp = await buildLibraryApp();
const supportApp = await buildSupportApp();
const library = await listen(libraryApp);
const support = await listen(supportApp);
const engine = await PlaywrightEngine.launch({ executablePath: CHROME });
const substrate = new Substrate(engine);

let libraryMap: SiteMap = parseMap(readFileSync(join(MAPS, "library", "v1.json"), "utf8"));
let supportMap: SiteMap = parseMap(readFileSync(join(MAPS, "support", "v1.json"), "utf8"));

function opOf(map: SiteMap, name: string): OpDef {
  const found = map.ops.find((op) => op.name === name);
  if (found === undefined) throw new Error(`no op "${name}"`);
  return found;
}

async function compileOp(input: {
  site: "library" | "support";
  name: string;
  intent: string;
  params: Record<string, unknown>;
  paramSets: Array<Record<string, unknown>>;
  start: string;
  steps: ScriptStep[];
  setup?: Array<{ op: string; params: Record<string, unknown> }>;
}): Promise<void> {
  const map = input.site === "library" ? libraryMap : supportMap;
  const base = input.site === "library" ? library : support;

  const result = await repairOp({
    map,
    op: opOf(map, input.name),
    intent: input.intent,
    params: input.params,
    paramSets: input.paramSets,
    dir: join(MAPS, input.site),
    baseUrl: base,
    executablePath: CHROME,
    ...(input.setup !== undefined ? { setup: input.setup } : {}),
    capture: async (url) => {
      await engine.navigate(url);
      return substrate.view();
    },
    repair: async () => {
      if (input.site === "support" && input.name !== "login") {
        await engine.evaluate("fetch('/logout', { method: 'POST' }).catch(() => undefined)");
      }
      await engine.navigate(new URL(input.start, base).toString());
      const run = await repairIntent({
        model: createRepairScript(input.steps),
        substrate,
        goal: input.intent,
        map,
        effect: opOf(map, input.name).effect,
        maxSteps: 24,
      });

      if (!run.ok) throw new Error(`${input.name}: ${run.reason ?? "the repair run failed"}`);
      return run.trace;
    },
  });

  if (!result.repaired || result.published === undefined) {
    throw new Error(`${input.name}: ${result.reason ?? "the repair did not publish"}`);
  }

  if (input.site === "library") {
    libraryMap = result.published.map;
  } else {
    supportMap = result.published.map;
  }

  const tier = result.candidate?.op.impls[0]?.tier ?? "unknown";
  console.log(`${input.site}.${input.name}: verified, ${tier}, v${result.published.version}`);
}

const search = (query: string): ScriptStep[] => [
  { kind: "act", role: "textbox", name: "Search books", do: "fill", value: query },
  { kind: "act", role: "button", name: "Search", do: "click" },
];

const login: ScriptStep[] = [
  { kind: "act", role: "textbox", name: "Email", do: "fill", value: "agent@example.com" },
  { kind: "act", role: "textbox", name: "Password", do: "fill", value: "support" },
  { kind: "act", role: "button", name: "Sign in", do: "click" },
];

try {
  await compileOp({
    site: "library",
    name: "search",
    intent: "Search the library for compilers.",
    params: { query: "compilers" },
    paramSets: [{ query: "compilers" }, { query: "orbital" }, { query: "apollo" }],
    start: "/",
    steps: [...search("compilers"), { kind: "done", answer: "Searched." }],
  });

  await compileOp({
    site: "library",
    name: "get_book",
    intent: "Search for compilers and open Compilers at Dawn.",
    params: { book_id: "b_102" },
    paramSets: [{ book_id: "b_102" }, { book_id: "b_103" }, { book_id: "b_105" }],
    start: "/",
    steps: [
      ...search("compilers"),
      { kind: "act", role: "link", name: "Compilers at Dawn", do: "click" },
      { kind: "done", answer: "Opened." },
    ],
  });

  await compileOp({
    site: "library",
    name: "borrow",
    intent: "Open Compilers at Dawn and borrow it.",
    params: { book_id: "b_102" },
    paramSets: [{ book_id: "b_101" }, { book_id: "b_104" }, { book_id: "b_106" }],
    start: "/",
    steps: [
      ...search("compilers"),
      { kind: "act", role: "link", name: "Compilers at Dawn", do: "click" },
      { kind: "act", role: "button", name: "Borrow", do: "click" },
      { kind: "done", answer: "Borrowed." },
    ],
  });

  await compileOp({
    site: "support",
    name: "login",
    intent: "Sign in to the support queue.",
    params: { email: "agent@example.com", password: "support" },
    paramSets: [
      { email: "agent@example.com", password: "support" },
      { email: "agent@example.com", password: "support" },
      { email: "agent@example.com", password: "support" },
    ],
    start: "/login",
    steps: [...login, { kind: "done", answer: "Signed in." }],
  });

  const supportLoginSetup = [
    { op: "login", params: { email: "agent@example.com", password: "support" } },
  ];

  await compileOp({
    site: "support",
    name: "filter_tickets",
    intent: "Filter the ticket list to open.",
    params: { status: "open" },
    paramSets: [{ status: "open" }, { status: "pending" }, { status: "closed" }],
    start: "/login",
    steps: [
      ...login,
      { kind: "act", role: "combobox", name: "Status", do: "select", value: "open" },
      { kind: "act", role: "button", name: "Filter", do: "click" },
      { kind: "done", answer: "Filtered." },
    ],
    setup: supportLoginSetup,
  });

  await compileOp({
    site: "support",
    name: "paginate",
    intent: "Open page 2 of the ticket list.",
    params: { page: 2 },
    paramSets: [{ page: 2 }, { page: 3 }, { page: 4 }],
    start: "/login",
    steps: [
      ...login,
      { kind: "act", role: "link", name: "Next", do: "click" },
      { kind: "done", answer: "Paged." },
    ],
    setup: supportLoginSetup,
  });

  await compileOp({
    site: "support",
    name: "create_ticket",
    intent: "Open a high-priority ticket about the printer.",
    params: { subject: "Printer is down", priority: "high" },
    paramSets: [
      { subject: "Printer is down", priority: "high" },
      { subject: "Cannot log in", priority: "normal" },
      { subject: "Invoice mismatch", priority: "low" },
    ],
    start: "/login",
    steps: [
      ...login,
      { kind: "act", role: "link", name: "Create ticket", do: "click" },
      { kind: "act", role: "textbox", name: "Subject", do: "fill", value: "Printer is down" },
      { kind: "act", role: "combobox", name: "Priority", do: "select", value: "high" },
      { kind: "act", role: "button", name: "Create ticket", do: "click" },
      { kind: "done", answer: "Opened." },
    ],
    setup: supportLoginSetup,
  });

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const freeze = {
    commit,
    model: "scripted",
    created_at: new Date().toISOString(),
    maps: {
      library: {
        version: libraryMap.version,
        path: `maps/heldout/library/v${libraryMap.version}.json`,
        ops: libraryMap.ops.map((op) => op.name),
      },
      support: {
        version: supportMap.version,
        path: `maps/heldout/support/v${supportMap.version}.json`,
        ops: supportMap.ops.map((op) => op.name),
      },
    },
  };

  writeFileSync(join(RESULTS, "freeze.json"), `${JSON.stringify(freeze, null, 2)}\n`, "utf8");
  console.log(`freeze commit ${commit}`);
} finally {
  await engine.close();
  await libraryApp.close();
  await supportApp.close();
}
