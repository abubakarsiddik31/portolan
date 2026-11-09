import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildStoreApp } from "../fixtures/store/v1/app.js";

const ROOT = join(import.meta.dirname, "../..");
const SERVER = join(ROOT, "packages/cli/dist/bin.js");
const MAPS = join(ROOT, "maps");
const RESULTS = join(ROOT, "bench/results");

// The store map's origin is http://127.0.0.1:4100; the server executes the
// op against this fixture.
const storeApp = await buildStoreApp();
await storeApp.listen({ port: 4100, host: "127.0.0.1" });

const PROMPT =
  'Use the portolan MCP server. Call list_sites, then open_site with site "store", then call the "search" op with query "tee". Return only JSON: {"sites": <number>, "op": "search", "ok": <true or false>}.';

type ClientResult = {
  status: "pass" | "fail";
  detail: string;
  output: string;
};

function run(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output: output.trim() });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("close", (code) => finish(code === 0));
    child.on("error", (error) => {
      output += `\n${error.message}`;
      finish(false);
    });
  });
}

function judge(output: string): { pass: boolean; detail: string } {
  const match = /\{[\s\S]*?"sites"[\s\S]*?\}/.exec(output);

  if (match === null) {
    return { pass: false, detail: "no conformance JSON in the output" };
  }

  try {
    const value = JSON.parse(match[0]) as { sites?: number; op?: string; ok?: boolean };
    if (value.sites === 3 && value.op === "search" && value.ok === true) {
      return { pass: true, detail: "sites=3, op=search, ok=true" };
    }
    return { pass: false, detail: `unexpected result: ${match[0]}` };
  } catch {
    return { pass: false, detail: `invalid JSON: ${match[0]}` };
  }
}

const temp = mkdtempSync(join(tmpdir(), "portolan-conformance-"));
const config = join(temp, "mcp.json");

writeFileSync(
  config,
  `${JSON.stringify(
    {
      mcpServers: {
        portolan: {
          command: "node",
          args: [SERVER, "mcp"],
          env: { MAPS_DIR: MAPS, DATABASE_PATH: ":memory:" },
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const clients: Record<string, ClientResult> = {};

const claude = await run(
  "claude",
  [
    "-p",
    PROMPT,
    "--mcp-config",
    config,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
  ],
  temp,
  120_000,
);
const claudeJudge = judge(claude.output);
clients["claude-code"] = {
  status: claudeJudge.pass ? "pass" : "fail",
  detail: claudeJudge.detail,
  output: claude.output.slice(-2_000),
};

const codex = await run(
  "codex",
  [
    "exec",
    "--skip-git-repo-check",
    "-c",
    'mcp_servers.portolan.command="node"',
    "-c",
    `mcp_servers.portolan.args=["${SERVER}","mcp"]`,
    "-c",
    `mcp_servers.portolan.env={MAPS_DIR="${MAPS}",DATABASE_PATH=":memory:"}`,
    PROMPT,
  ],
  temp,
  120_000,
);
const codexJudge = judge(codex.output);
clients["codex-cli"] = {
  status: codexJudge.pass ? "pass" : "fail",
  detail: codexJudge.pass
    ? codexJudge.detail
    : codex.output.includes("402")
      ? "402 Payment Required (deactivated workspace)"
      : codexJudge.detail,
  output: codex.output.slice(-2_000),
};

await run(
  "gemini",
  [
    "mcp",
    "add",
    "--scope",
    "project",
    "portolan",
    "node",
    SERVER,
    "mcp",
    "-e",
    `MAPS_DIR=${MAPS}`,
    "-e",
    "DATABASE_PATH=:memory:",
    "--trust",
  ],
  temp,
  30_000,
);

const gemini = await run(
  "gemini",
  [
    "-p",
    PROMPT,
    "--skip-trust",
    "--approval-mode",
    "yolo",
    "--allowed-mcp-server-names",
    "portolan",
  ],
  temp,
  180_000,
);
const geminiJudge = judge(gemini.output);
clients["gemini-cli"] = {
  status: geminiJudge.pass ? "pass" : "fail",
  detail: geminiJudge.pass ? geminiJudge.detail : geminiJudge.detail,
  output: gemini.output.slice(-2_000),
};

const record = {
  created_at: new Date().toISOString(),
  server: "packages/cli/dist/bin.js mcp",
  prompt: PROMPT,
  clients,
};

writeFileSync(join(RESULTS, "conformance.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

const lines = [
  "# Client conformance",
  "",
  `Server: \`${record.server}\``,
  "",
  "| Client | Status | Detail |",
  "|---|---|---|",
  ...Object.entries(clients).map(
    ([client, result]) => `| ${client} | ${result.status} | ${result.detail} |`,
  ),
  "",
  'The suite asks each client to call `list_sites`, `open_site("store")`, and',
  '`call("search", {"query":"tee"})`, then return a JSON marker. The server is',
  "`portolan mcp`, which launches Chromium and executes the op through the url",
  "tier, so `ok: true` means the client reached a real result, not just the surface.",
  "",
];

writeFileSync(join(RESULTS, "conformance.md"), lines.join("\n"), "utf8");
await storeApp.close();
console.log(lines.join("\n"));
