import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ToolBackend, ToolDef, ToolResult } from "./types.js";

const execFileAsync = promisify(execFile);

const TOOLS: ToolDef[] = [
  {
    name: "open",
    description: "Navigate to a URL, absolute or relative to the current site.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "snapshot",
    description: "Return the accessibility tree with refs like @e1.",
    inputSchema: { type: "object", properties: { interactive: { type: "boolean" } } },
  },
  {
    name: "find",
    description:
      "Find an element by role, text, label, placeholder, alt, title or testid, then click, fill, check or hover it.",
    inputSchema: {
      type: "object",
      properties: {
        locator: { type: "string" },
        value: { type: "string" },
        action: { type: "string" },
        text: { type: "string" },
        name: { type: "string" },
      },
      required: ["locator", "value"],
    },
  },
  {
    name: "click",
    description: "Click an element by ref or CSS selector.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "fill",
    description: "Clear and fill an input by ref or CSS selector.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, text: { type: "string" } },
      required: ["target", "text"],
    },
  },
  {
    name: "select",
    description: "Select a dropdown option by ref or CSS selector.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, value: { type: "string" } },
      required: ["target", "value"],
    },
  },
  {
    name: "press",
    description: "Press a key such as Enter or Tab.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "get",
    description: "Read the page URL, title, or text of a selector.",
    inputSchema: {
      type: "object",
      properties: { what: { type: "string" }, selector: { type: "string" } },
      required: ["what"],
    },
  },
  {
    name: "read",
    description: "Return the page as agent-readable text.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "eval",
    description: "Evaluate JavaScript in the page and return the result.",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
  {
    name: "wait",
    description: "Wait for a number of milliseconds.",
    inputSchema: { type: "object", properties: { ms: { type: "number" } }, required: ["ms"] },
  },
  {
    name: "close",
    description: "Close the browser session.",
    inputSchema: { type: "object", properties: {} },
  },
];

export type AgentBrowserBackendOptions = {
  baseURLs: Record<string, string>;
  session?: string;
  executablePath?: string;
  binary?: string;
  timeoutMs?: number;
};

function resolveBinary(): string {
  const candidates = [
    process.env.AGENT_BROWSER_BIN,
    join(process.cwd(), "bench/node_modules/.bin/agent-browser"),
    join(process.cwd(), "node_modules/.bin/agent-browser"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "agent-browser";
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

/**
 * `agent-browser eval` prints its result as a JSON token, and our evaluate
 * expression is already a JSON string, so the output is encoded twice. Peel
 * one layer so the success checker can parse a single object.
 */
function unwrapEval(text: string): string {
  try {
    const outer = JSON.parse(text) as unknown;
    if (typeof outer === "string") return outer;
    if (typeof outer === "object" && outer !== null && "data" in outer) {
      const result = (outer as { data?: { result?: unknown } }).data?.result;
      return typeof result === "string" ? result : JSON.stringify(result);
    }
    return JSON.stringify(outer);
  } catch {
    return text;
  }
}

function normalizeTarget(target: string): string {
  if (target.startsWith("@") || target.startsWith("#") || target.startsWith(".")) return target;
  if (target.startsWith("[")) return target;
  if (/^e\d+$/.test(target)) return `@${target}`;
  return target;
}

/**
 * Arm B: the same runner over agent-browser's CLI.
 *
 * Each tool call is one short shell command against a daemon-owned session.
 * The session is unique per backend so parallel tasks do not share cookies.
 */
export class AgentBrowserBackend implements ToolBackend {
  private readonly baseURLs: Record<string, string>;
  private readonly session: string;
  private readonly binary: string;
  private readonly executablePath: string | undefined;
  private readonly timeoutMs: number;
  private currentBaseURL: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(options: AgentBrowserBackendOptions) {
    this.baseURLs = options.baseURLs;
    this.session = options.session ?? `portolan-${randomUUID()}`;
    this.binary = options.binary ?? resolveBinary();
    this.executablePath = options.executablePath;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async listTools(): Promise<ToolDef[]> {
    return TOOLS;
  }

  async openSite(site: string): Promise<ToolResult> {
    const baseURL = this.baseURLs[site];
    if (baseURL === undefined) return { ok: false, text: `no base URL for "${site}"` };
    this.currentBaseURL = baseURL;

    const opened = await this.callTool("open", { url: baseURL });
    if (!opened.ok) return opened;

    const snapshot = await this.callTool("snapshot", { interactive: true });
    return {
      ok: snapshot.ok,
      text: `OPEN ${site} ${baseURL}\n${snapshot.text}`,
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (this.closed && name !== "close") {
      return { ok: false, text: "session is closed" };
    }
    return this.enqueue(() => this.run(name, args));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.enqueue(() => this.run("close", {}));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    let command: string[];
    try {
      command = this.command(name, args);
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }

    const argv = [
      "--session",
      this.session,
      ...(this.executablePath ? ["--executable-path", this.executablePath] : []),
      ...command,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(this.binary, argv, {
        timeout: this.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
      const text = stdout.trim() || stderr.trim();
      return { ok: true, text: name === "evaluate" ? unwrapEval(text) : text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderr =
        typeof error === "object" && error !== null && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr)
          : "";
      return { ok: false, text: stderr.trim() || message };
    }
  }

  private command(name: string, args: Record<string, unknown>): string[] {
    switch (name) {
      case "open":
        return ["open", this.resolveURL(requireString(args, "url"))];
      case "snapshot":
        return args.interactive === false ? ["snapshot"] : ["snapshot", "-i"];
      case "find": {
        const command = [
          "find",
          requireString(args, "locator"),
          requireString(args, "value"),
          optionalString(args, "action") ?? "click",
        ];
        const text = optionalString(args, "text");
        const accessibleName = optionalString(args, "name");
        if (text) command.push(text);
        if (accessibleName) command.push("--name", accessibleName);
        return command;
      }
      case "click":
        return ["click", normalizeTarget(requireString(args, "target"))];
      case "fill":
        return [
          "fill",
          normalizeTarget(requireString(args, "target")),
          requireString(args, "text"),
        ];
      case "select":
        return [
          "select",
          normalizeTarget(requireString(args, "target")),
          requireString(args, "value"),
        ];
      case "press":
        return ["press", requireString(args, "key")];
      case "get": {
        const what = requireString(args, "what");
        const selector = optionalString(args, "selector");
        return selector ? ["get", what, normalizeTarget(selector)] : ["get", what];
      }
      case "read":
        return ["read"];
      case "eval":
        return ["eval", requireString(args, "expression")];
      case "evaluate":
        return [
          "eval",
          `JSON.stringify({ ok: true, value: (${requireString(args, "expression")}) })`,
        ];
      case "wait":
        return ["wait", String(requireNumber(args, "ms"))];
      case "close":
        return ["close"];
      default:
        throw new Error(`unknown agent-browser tool "${name}"`);
    }
  }

  private resolveURL(url: string): string {
    if (/^https?:\/\//.test(url)) return url;
    if (!this.currentBaseURL) throw new Error("open a site first or pass an absolute URL");
    return new URL(url, this.currentBaseURL).toString();
  }
}
