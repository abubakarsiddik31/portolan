import {
  findChrome,
  PlaywrightEngine,
  rankAffordances,
  renderAffordances,
  Substrate,
  type SubstrateView,
} from "@portolan/substrate";
import type { ToolBackend, ToolDef, ToolResult } from "./types.js";

export type SubstrateBackendOptions = {
  baseURLs: Record<string, string>;
  executablePath?: string;
  headless?: boolean;
};

const TOOLS: ToolDef[] = [
  {
    name: "view",
    description:
      "Show the current page's ranked affordances with refs. Call this after a navigation or when unsure what is on screen.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "act",
    description:
      "Act on a ref from view: click, check, uncheck, fill, select, or press. Fill and select need a value; press needs a key.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        do: {
          type: "string",
          enum: ["click", "check", "uncheck", "fill", "select", "press"],
        },
        value: { type: "string" },
        key: { type: "string" },
      },
      required: ["ref", "do"],
    },
  },
  {
    name: "read",
    description: "Read the page text, or one ref's accessible text.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } } },
  },
];

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

/**
 * Arm C: the substrate's view / act / read loop, with no map ops.
 *
 * This is the runtime's escape hatch without the map. It measures what an
 * agent can do with ranked affordances and document-scoped refs alone, which
 * is the floor the compiler has to beat.
 */
export class SubstrateBackend implements ToolBackend {
  private readonly baseURLs: Record<string, string>;
  private readonly executablePath: string | undefined;
  private readonly headless: boolean;
  private engine: PlaywrightEngine | undefined;
  private substrate: Substrate | undefined;
  private last: Array<{ ref?: string; role: string; name: string }> = [];

  constructor(options: SubstrateBackendOptions) {
    this.baseURLs = options.baseURLs;
    this.executablePath = options.executablePath ?? findChrome();
    this.headless = options.headless ?? true;
  }

  async listTools(): Promise<ToolDef[]> {
    return TOOLS;
  }

  async openSite(site: string): Promise<ToolResult> {
    const base = this.baseURLs[site];
    if (base === undefined) return { ok: false, text: `no base URL for "${site}"` };

    const engine = await this.ensureEngine();
    await engine.navigate(base);
    return this.view();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case "view":
        return this.view();
      case "act":
        return this.act(args);
      case "read":
        return this.read(args);
      case "evaluate":
        return this.evaluate(args);
      default:
        return { ok: false, text: `unknown tool "${name}"; arm C has no map ops` };
    }
  }

  /** Resolve a role and name to the ref from the latest view. */
  resolveRef(role: string, name: string): string | undefined {
    return this.last.find((affordance) => affordance.role === role && affordance.name === name)
      ?.ref;
  }

  async close(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    this.substrate = undefined;
    this.last = [];
    if (engine !== undefined) await engine.close();
  }

  private async ensureEngine(): Promise<PlaywrightEngine> {
    if (this.engine !== undefined) return this.engine;
    if (this.executablePath === undefined) throw new Error("Chrome is required for arm C");

    this.engine = await PlaywrightEngine.launch({
      executablePath: this.executablePath,
      headless: this.headless,
    });
    this.substrate = new Substrate(this.engine);
    return this.engine;
  }

  private current(): Substrate {
    if (this.substrate === undefined) throw new Error("open a site first");
    return this.substrate;
  }

  /** Rank a capture and remember its refs for the scripted model. */
  private rank(view: SubstrateView) {
    const ranked = rankAffordances(view.snapshot.nodes, { refs: view.refs });

    this.last = ranked.affordances.map((affordance) => ({
      ...(affordance.ref !== undefined ? { ref: affordance.ref } : {}),
      role: affordance.role,
      name: affordance.name,
    }));

    return ranked;
  }

  private async view(): Promise<ToolResult> {
    const view = await this.current().view();
    const ranked = this.rank(view);
    const rendered = renderAffordances(ranked.affordances);

    return {
      ok: true,
      text: JSON.stringify({
        url: view.snapshot.url,
        doc: view.snapshot.doc,
        v: view.snapshot.v,
        affordances: ranked.affordances.map((affordance) => ({
          ref: affordance.ref,
          role: affordance.role,
          name: affordance.name,
          ctx: affordance.ctx,
        })),
        text: rendered.text,
        omitted: ranked.omitted,
      }),
    };
  }

  private async act(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = requireString(args, "ref");
    const doValue = requireString(args, "do");

    if (
      doValue !== "click" &&
      doValue !== "check" &&
      doValue !== "uncheck" &&
      doValue !== "fill" &&
      doValue !== "select" &&
      doValue !== "press"
    ) {
      return { ok: false, text: `unknown action "${doValue}"` };
    }

    const value = optionalString(args, "value");
    const key = optionalString(args, "key");

    const result = await this.current().act({
      ref,
      do: doValue,
      ...(value !== undefined ? { value } : {}),
      ...(key !== undefined ? { key } : {}),
    });

    const state = this.current().state();
    if (state !== undefined) this.rank(state);

    return { ok: result.ok, text: JSON.stringify(result) };
  }

  private async read(args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.current().read(optionalString(args, "ref"));
    return { ok: true, text: JSON.stringify(result) };
  }

  private async evaluate(args: Record<string, unknown>): Promise<ToolResult> {
    const expression = requireString(args, "expression");
    const engine = await this.ensureEngine();
    const value = await engine.evaluate<unknown>(expression);
    return { ok: true, text: JSON.stringify({ ok: true, value }) };
  }
}
