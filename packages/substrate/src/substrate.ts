import type { Action, Effect, Engine, Snapshot } from "./engine.js";
import { EngineError } from "./engine.js";
import { type BlockedRequest, EgressGuard, type EgressPolicy, type Resolver } from "./policy.js";
import { type RefMap, RefRegistry } from "./refs.js";

export type SubstrateView = {
  snapshot: Snapshot;
  refs: RefMap;
};

export type HttpRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type HttpResponse = {
  status: number;
  text: string;
  json: unknown;
  /** The final URL after redirects, when the engine reports it. */
  url?: string;
};

export type ActRequest = {
  ref: string;
  do: "click" | "check" | "uncheck" | "fill" | "select" | "press";
  value?: string;
  key?: string;
};

export type DeltaEntry = {
  kind: "added" | "removed" | "changed";
  ref?: string;
  role: string;
  name: string;
};

export type Delta = {
  /** True when the document changed; the caller should re-read. */
  navigation: boolean;
  entries: DeltaEntry[];
};

export type ActResult =
  | {
      ok: true;
      doc: number;
      v: number;
      url: string;
      title: string;
      effects: Effect[];
      delta: Delta;
    }
  | { ok: false; code: "stale_ref"; current_doc: number; new_ref?: string }
  | {
      ok: false;
      code: "not_interactive";
      blocker_ref?: string;
      blocker_backend_node_id?: number;
    }
  | { ok: false; code: "invalid_request"; message: string };

/**
 * The stateful substrate verbs an agent uses when no op fits: view and act.
 *
 * `view` captures the document, builds refs, and remembers the map. `act`
 * resolves a ref, dispatches through the engine, then re-captures the
 * document so the caller gets effects and a small delta instead of a full
 * re-read.
 */
export type SubstrateOptions = {
  /** When present, `fetch` and `goto` are default-deny. */
  policy?: EgressPolicy;
  onBlocked?: (event: BlockedRequest) => void;
  /** Hostname resolver for the rebinding check; injectable for tests. */
  resolve?: Resolver;
};

export class Substrate {
  private readonly registry = new RefRegistry();
  private readonly guard: EgressGuard | undefined;
  private current: RefMap | undefined;
  private last: Snapshot | undefined;

  constructor(
    private readonly engine: Engine,
    options: SubstrateOptions = {},
  ) {
    this.guard =
      options.policy === undefined
        ? undefined
        : new EgressGuard(options.policy, options.onBlocked, options.resolve);
  }

  async view(): Promise<SubstrateView> {
    const snapshot = await this.engine.snapshot();
    const refs = this.registry.build(snapshot.nodes, snapshot.doc);
    this.current = refs;
    this.last = snapshot;

    return { snapshot, refs };
  }

  /** Run a fetch inside the live page, with the page's cookies and origin. */
  async fetch(request: HttpRequest): Promise<HttpResponse> {
    await this.guard?.checkResolved(
      absolute(request.url, this.last?.url ?? "http://localhost"),
      request.method,
    );

    const body =
      request.body === undefined ? "undefined" : `JSON.stringify(${JSON.stringify(request.body)})`;

    const expression = `(async () => {
      const response = await fetch(${JSON.stringify(request.url)}, {
        method: ${JSON.stringify(request.method)},
        headers: ${JSON.stringify(request.headers ?? {})},
        body: ${body},
        credentials: "same-origin",
        redirect: "follow",
      });
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: response.status, text, json, url: response.url };
    })()`;

    const response = await this.engine.evaluate<HttpResponse>(expression);

    // A redirect may have landed outside the allowlist. The request already
    // followed it, so this cannot undo the egress; it refuses to return the
    // response and records the block. DNS rebinding is a separate gap.
    if (response.url !== undefined) {
      this.guard?.check(response.url, request.method, "redirect");
    }

    return response;
  }

  /** Navigate, then capture. The `goto` substrate verb. */
  async goto(url: string): Promise<SubstrateView> {
    await this.guard?.checkResolved(url, "GET");
    await this.engine.navigate(url);
    return this.view();
  }

  /** The last captured document and refs, without taking a new snapshot. */
  state(): SubstrateView | undefined {
    if (this.last === undefined || this.current === undefined) return undefined;
    return { snapshot: this.last, refs: this.current };
  }

  /** Read the page, or one ref's accessible text. */
  async read(ref?: string): Promise<{ text: string }> {
    const view = this.state() ?? (await this.view());

    if (ref === undefined) {
      const parts = view.snapshot.nodes
        .filter((node) => node.visible && node.name.length > 0)
        .map((node) => node.name);
      return { text: parts.join("\n") };
    }

    const entry = view.refs.byRef.get(ref);
    if (entry === undefined) return { text: "" };

    const node = view.snapshot.nodes.find((candidate) => candidate.nodeId === entry.nodeId);
    return { text: node?.name ?? "" };
  }

  async act(request: ActRequest): Promise<ActResult> {
    const before = this.last;
    const beforeRefs = this.current;

    const resolution = this.registry.resolve(request.ref);

    if (!resolution.ok) {
      return resolution.new_ref === undefined
        ? { ok: false, code: "stale_ref", current_doc: resolution.current_doc }
        : {
            ok: false,
            code: "stale_ref",
            current_doc: resolution.current_doc,
            new_ref: resolution.new_ref,
          };
    }

    const action = toAction(request, resolution.entry.backendNodeId);
    if (typeof action === "string") {
      return { ok: false, code: "invalid_request", message: action };
    }

    try {
      const result = await this.engine.dispatch(action);

      const snapshot = await this.engine.snapshot();
      const refs = this.registry.build(snapshot.nodes, snapshot.doc);
      this.current = refs;
      this.last = snapshot;

      const delta =
        before !== undefined && beforeRefs !== undefined
          ? diff(before, beforeRefs, snapshot, refs)
          : { navigation: false, entries: [] };

      return {
        ok: true,
        doc: result.doc,
        v: result.v,
        url: result.url,
        title: result.title,
        effects: result.effects,
        delta,
      };
    } catch (error) {
      if (error instanceof EngineError && error.code === "not_interactive") {
        const blocker = error.details.blockerBackendNodeId;

        if (typeof blocker !== "number") {
          return { ok: false, code: "not_interactive" };
        }

        const entry = this.current?.byBackend.get(blocker);

        return entry === undefined
          ? { ok: false, code: "not_interactive", blocker_backend_node_id: blocker }
          : {
              ok: false,
              code: "not_interactive",
              blocker_backend_node_id: blocker,
              blocker_ref: entry.ref,
            };
      }

      throw error;
    }
  }
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function toAction(request: ActRequest, backendNodeId: number): Action | string {
  switch (request.do) {
    case "click":
    case "check":
    case "uncheck":
      return { do: request.do, backendNodeId };
    case "fill":
    case "select":
      if (request.value === undefined) {
        return `"${request.do}" needs a value`;
      }
      return { do: request.do, backendNodeId, value: request.value };
    case "press":
      if (request.key === undefined) {
        return '"press" needs a key';
      }
      return { do: "press", key: request.key };
  }
}

function diff(before: Snapshot, beforeRefs: RefMap, after: Snapshot, afterRefs: RefMap): Delta {
  if (before.doc !== after.doc || before.url !== after.url) {
    return { navigation: true, entries: [] };
  }

  const beforeNodes = new Map(before.nodes.map((node) => [node.nodeId, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.nodeId, node]));
  const entries: DeltaEntry[] = [];

  for (const [ref, entry] of afterRefs.byRef) {
    const previous = beforeRefs.byRef.get(ref);

    if (previous === undefined) {
      entries.push({ kind: "added", ref, role: entry.role, name: entry.name });
      continue;
    }

    const beforeNode = beforeNodes.get(previous.nodeId);
    const afterNode = afterNodes.get(entry.nodeId);

    if (
      beforeNode !== undefined &&
      afterNode !== undefined &&
      stable(beforeNode.properties) !== stable(afterNode.properties)
    ) {
      entries.push({ kind: "changed", ref, role: entry.role, name: entry.name });
    }
  }

  for (const [ref, entry] of beforeRefs.byRef) {
    if (!afterRefs.byRef.has(ref)) {
      entries.push({ kind: "removed", ref, role: entry.role, name: entry.name });
    }
  }

  return { navigation: false, entries };
}

/** Property order is not meaningful; compare a sorted projection. */
function stable(properties: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(properties)
      .sort()
      .map((key) => [key, properties[key]]),
  );
}
