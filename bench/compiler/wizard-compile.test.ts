import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileCandidates, publishMap, repairIntent, verifyOp } from "@portolan/compiler";
import { parseMap, type SiteMap } from "@portolan/protocol";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWizardApp } from "../fixtures/wizard/v1/app.js";
import { createRepairScript } from "../repair/scripted-model.js";

const MAPS = join(import.meta.dirname, "../../maps");
const SAMPLE = join(process.cwd(), "bench/tasks/files/sample.txt");
const CHROME = findChrome();
const ENABLED =
  CHROME !== undefined && (process.env.CI !== "true" || process.env.PORTOLAN_BROWSER_TESTS === "1");

function map(site: string): SiteMap {
  return parseMap(readFileSync(join(MAPS, site, "v1.json"), "utf8"));
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture did not get a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

const wizardSteps = [
  {
    kind: "act" as const,
    role: "textbox",
    name: "Full name",
    do: "fill" as const,
    value: "Ada Lovelace",
  },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Work email",
    do: "fill" as const,
    value: "ada@example.com",
  },
  { kind: "act" as const, role: "button", name: "Continue", do: "click" as const },
  {
    kind: "act" as const,
    role: "textbox",
    name: "Company",
    do: "fill" as const,
    value: "Analytical Engines",
  },
  {
    kind: "act" as const,
    role: "combobox",
    name: "Your role",
    do: "select" as const,
    value: "Engineer",
  },
  { kind: "act" as const, role: "spinbutton", name: "Team size", do: "fill" as const, value: "12" },
  { kind: "act" as const, role: "button", name: "Continue", do: "click" as const },
  {
    kind: "act" as const,
    role: "button",
    name: "Attachment (PDF, TXT or PNG, max 1 MB)",
    do: "fill" as const,
    value: SAMPLE,
  },
  {
    kind: "act" as const,
    role: "checkbox",
    name: "I confirm the details above are correct.",
    do: "check" as const,
  },
  { kind: "act" as const, role: "button", name: "Submit application", do: "click" as const },
  { kind: "done" as const, answer: "Application submitted." },
];

describe.skipIf(!ENABLED)("wizard compile", () => {
  let wizardApp: FastifyInstance | undefined;
  let wizard = "";
  let engine: PlaywrightEngine | undefined;

  beforeAll(async () => {
    wizardApp = await buildWizardApp();
    wizard = await listen(wizardApp);
    engine = await PlaywrightEngine.launch({ executablePath: CHROME as string });
  }, 60_000);

  afterAll(async () => {
    if (engine !== undefined) await engine.close();
    await wizardApp?.close();
  });

  it("compiles and verifies the wizard upload as a ui op", async () => {
    const wizardMap = map("wizard");
    if (engine === undefined) throw new Error("the engine is not running");
    const active = engine;
    const substrate = new Substrate(active);
    await active.navigate(`${wizard}/step/1`);

    const run = await repairIntent({
      model: createRepairScript(wizardSteps),
      substrate,
      goal: "Complete the application with the attachment.",
      map: wizardMap,
      effect: "write",
      maxSteps: 20,
      check: async () => {
        const url = await active.evaluate<string>("location.href");
        return /\/done\/sub_\d+$/.test(new URL(url).pathname);
      },
    });

    expect(run.ok).toBe(true);

    const candidates = await compileCandidates({
      map: wizardMap,
      traces: [{ trace: run.trace, source: "trace:wizard-submit" }],
      capture: async (url) => {
        await active.navigate(url);
        return substrate.view();
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.op.name).toBe("submit_application");
    expect(candidates[0]?.tier).toBe("ui");
    expect(candidates[0]?.op.impls[0]?.tier).toBe("ui");

    const candidate = candidates[0];
    if (candidate === undefined) throw new Error("the wizard candidate is missing");

    const report = await verifyOp({
      map: wizardMap,
      op: candidate.op,
      paramSets: [
        {
          name: "Ada Lovelace",
          email: "ada@example.com",
          company: "Analytical Engines",
          role: "Engineer",
          team_size: 12,
          file_path: SAMPLE,
        },
        {
          name: "Grace Hopper",
          email: "grace@example.com",
          company: "Compiler Works",
          role: "Engineer",
          team_size: 40,
          file_path: SAMPLE,
        },
        {
          name: "Alan Turing",
          email: "alan@example.com",
          company: "Bletchley Labs",
          role: "Product manager",
          team_size: 25,
          file_path: SAMPLE,
        },
      ],
      baseUrl: wizard,
      executablePath: CHROME as string,
    });

    expect(report.verified).toBe(true);
    expect(report.impls[0]).toMatchObject({ tier: "ui", verified: true });
    expect(report.impls[0]?.runs).toHaveLength(3);

    const temp = await mkdtemp(join(tmpdir(), "portolan-wizard-"));

    try {
      const dir = join(temp, "wizard");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "v1.json"), readFileSync(join(MAPS, "wizard", "v1.json")));

      const published = await publishMap({
        dir,
        map: { ...wizardMap, ops: [] },
        candidates: [
          {
            op: candidate.op,
            verified: report.verified,
            source: "trace:wizard-submit",
          },
        ],
      });

      const compiled = parseMap(await readFile(published.path, "utf8"));
      expect(compiled.version).toBe(2);
      expect(compiled.ops.map((op) => op.name)).toEqual(["submit_application"]);
      expect(compiled.ops[0]?.returns).toMatchObject({
        type: "object",
        properties: { submission_id: { type: "string" } },
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 240_000);
});
