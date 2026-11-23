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
  /** Set these files on the target, or the nearest file input. */
  files?: string[];
  /**
   * Verify a fill by reading the control's value back after the dispatch.
   * On a mismatch the substrate clicks to re-anchor the node and refills
   * once; a second mismatch returns `fill_lost`. Opt-in because sites that
   * reformat values (phones, cards) legitimately differ from the typed
   * text. Fills only; `select` verifies nothing today.
   */
  verify?: boolean;
};

export type CallOptions = {
  /**
   * Skip the quiescence settle for this one call and capture immediately.
   * Tier ops hold a p50 budget and navigate per call, so they opt out;
   * agent-facing verbs settle by default.
   */
  settle?: boolean;
  /**
   * On a stale ref with no suggested replacement, take one fresh capture and
   * re-resolve before failing. This is the case the registry cannot see: the
   * substrate's map predates an external navigation the caller never went
   * through. On by default; the retry costs one snapshot, and only on the
   * failure path.
   */
  recovery?: boolean;
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
      download?: { path: string; filename: string };
    }
  | { ok: false; code: "stale_ref"; current_doc: number; new_ref?: string }
  | {
      ok: false;
      code: "fill_lost";
      /** The value did not take after a click-to-focus refill. */
      message: string;
    }
  | {
      ok: false;
      code: "not_interactive";
      /** Why the action could not run, when no blocker was found. */
      reason?: string;
      blocker_ref?: string;
      blocker_backend_node_id?: number;
      blocker_role?: string;
      blocker_name?: string;
      /** DOM facts about the blocker, when it has no semantic ref. */
      blocker_tag?: string;
      blocker_text?: string;
      blocker_dom_id?: string;
      blocker_class?: string;
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
  /**
   * How long `goto` and `act` wait for the page to go quiet before the
   * capture they return (see the quiescence contract on {@link Substrate}).
   * Default 8000 ms; `0` disables settling entirely. The settle returns
   * early once the document is stable, so a quiet page pays little.
   */
  settleBudgetMs?: number;
};

export class Substrate {
  private readonly registry = new RefRegistry();
  private readonly guard: EgressGuard | undefined;
  private readonly settleBudgetMs: number;
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
    this.settleBudgetMs = options.settleBudgetMs ?? 8_000;
  }

  /**
   * Quiescence contract. `goto` and `act` capture the document only after
   * the page has gone quiet: an SPA that hydrates late, or an action whose
   * fetch re-renders, is settled first, so the view the caller receives is
   * current. The engine's `navigate` and `dispatch` deliberately resolve
   * early — tier ops navigate per call and hold a p50 budget, so settling
   * belongs to the agent verbs, not the engine. A tier op may call this when
   * a capture misses content it expects, trading latency only on the miss.
   *
   * The settle signal is capture stability: consecutive snapshots must agree
   * on url, title, and node names for 750 ms, or the budget runs out.
   * Exhaustion is not an error; the caller receives whatever is on the page,
   * which is the pre-contract behavior.
   */
  async settle(): Promise<SubstrateView> {
    const MIN_STABLE_MS = 750;
    const deadline = Date.now() + this.settleBudgetMs;
    let view = await this.view();
    if (this.settleBudgetMs <= 0) return view;

    let last = "";
    let stableSince: number | undefined;

    while (Date.now() < deadline) {
      const fingerprint = JSON.stringify([
        view.snapshot.url,
        view.snapshot.title,
        view.snapshot.nodes
          .map((node) => `${node.role}:${node.name}`)
          .join("|")
          .slice(0, 4000),
      ]);

      if (fingerprint === last) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= MIN_STABLE_MS) return view;
      } else {
        stableSince = undefined;
        last = fingerprint;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      view = await this.view();
    }

    return view;
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

  /** Navigate, let the page go quiet, then capture. The `goto` verb. */
  async goto(url: string, options: CallOptions = {}): Promise<SubstrateView> {
    await this.guard?.checkResolved(url, "GET");
    await this.engine.navigate(url);
    return options.settle === false ? this.view() : this.settle();
  }

  /** The last captured document and refs, without taking a new snapshot. */
  state(): SubstrateView | undefined {
    if (this.last === undefined || this.current === undefined) return undefined;
    return { snapshot: this.last, refs: this.current };
  }

  /** Read the page, or one ref's accessible text. */
  /** A PNG of the current viewport, when the engine supports it. */
  async screenshot(): Promise<Uint8Array | undefined> {
    return this.engine.screenshot?.();
  }

  async read(ref?: string): Promise<{ text: string }> {
    // A no-ref read means "the page as it is now". Reusing the last snapshot
    // returns the page from before a `call` navigation, or before a data
    // fetch resolved, which is an empty or stale read.
    const view = ref === undefined ? await this.view() : (this.state() ?? (await this.view()));

    if (ref === undefined) {
      const parts = view.snapshot.nodes
        .filter((node) => node.visible && node.name.length > 0)
        .map((node) => node.name);
      return { text: parts.join("\n") };
    }

    const entry = view.refs.byRef.get(ref);
    if (entry === undefined) return { text: "" };

    // A form control's accessible name is its label ("Email"), not what the
    // user typed. Ask the page for the current value first.
    try {
      const value = await this.engine.readValue(entry.backendNodeId);
      if (value !== undefined && value.length > 0) return { text: value };
    } catch {
      // A node without a value falls back to its accessible name.
    }

    const node = view.snapshot.nodes.find((candidate) => candidate.nodeId === entry.nodeId);
    return { text: node?.name ?? "" };
  }

  async act(request: ActRequest, options: CallOptions = {}): Promise<ActResult> {
    const before = this.last;
    const beforeRefs = this.current;

    let resolution = this.registry.resolve(request.ref);

    if (!resolution.ok && resolution.new_ref === undefined && options.recovery !== false) {
      // One fresh capture before giving up: the substrate's map may predate
      // a navigation that happened outside its verbs (a driver's goto, a
      // redirect, a site-initiated route change). The new_ref suggestion
      // path is left to the caller on purpose - a replacement is a hint,
      // not a license to act.
      await this.view();
      resolution = this.registry.resolve(request.ref);
    }

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

    if (request.files !== undefined && request.files.length > 0) {
      try {
        await this.engine.setFiles(resolution.entry.backendNodeId, request.files);
      } catch (error) {
        if (error instanceof EngineError && error.code === "file_input_not_found") {
          return { ok: false, code: "invalid_request", message: "no file input on the page" };
        }
        if (error instanceof EngineError && error.code === "not_found") {
          return { ok: false, code: "stale_ref", current_doc: this.last?.doc ?? 0 };
        }
        throw error;
      }

      const snapshot = await this.engine.snapshot();
      const refs = this.registry.build(snapshot.nodes, snapshot.doc);
      this.current = refs;
      this.last = snapshot;

      return {
        ok: true,
        doc: snapshot.doc,
        v: snapshot.v,
        url: snapshot.url,
        title: snapshot.title,
        effects: [
          {
            kind: "value",
            backendNodeId: resolution.entry.backendNodeId,
            value: request.files.join(", "),
          },
        ],
        delta: { navigation: false, entries: [] },
      };
    }

    const action = toAction(request, resolution.entry.backendNodeId);
    if (typeof action === "string") {
      return { ok: false, code: "invalid_request", message: action };
    }

    try {
      const result = await this.engine.dispatch(action);

      // Verified fill: the worst failure a fill can have is reporting
      // success while the value silently never took. Read it back; on a
      // mismatch, click to re-anchor the node (SPA re-renders replace the
      // element under the ref) and refill once before giving up.
      if (action.do === "fill" && request.verify === true) {
        const fillValue: string = request.value ?? "";
        const entry = resolution.entry;
        const stuck = await this.engine.readValue(entry.backendNodeId);
        if (stuck !== fillValue) {
          await this.engine.dispatch({ do: "click", backendNodeId: entry.backendNodeId });
          await this.engine.dispatch({
            do: "fill",
            backendNodeId: entry.backendNodeId,
            value: fillValue,
          });
          const again = await this.engine.readValue(entry.backendNodeId);
          if (again !== fillValue) {
            return {
              ok: false,
              code: "fill_lost",
              message: `fill on ${entry.role} "${entry.name}" did not stick (read back ${
                again === undefined ? "nothing" : `${again.length} chars`
              })`,
            };
          }
        }
      }

      if (options.settle === false) {
        // Tier path: capture immediately, engine values are authoritative.
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
          ...(result.download !== undefined ? { download: result.download } : {}),
        };
      }

      // Quiescence: the settled view is also the delta baseline, and its doc
      // epoch is authoritative — a dispatch that navigated may still be
      // hydrating when the engine resolves.
      const settled = await this.settle();
      const snapshot = settled.snapshot;
      const refs = settled.refs;

      const delta =
        before !== undefined && beforeRefs !== undefined
          ? diff(before, beforeRefs, snapshot, refs)
          : { navigation: false, entries: [] };

      return {
        ok: true,
        doc: snapshot.doc,
        v: snapshot.v,
        url: snapshot.url,
        title: snapshot.title,
        effects: result.effects,
        delta,
        ...(result.download !== undefined ? { download: result.download } : {}),
      };
    } catch (error) {
      if (error instanceof EngineError && error.code === "disabled") {
        return {
          ok: false,
          code: "invalid_request",
          message: `${resolution.entry.role} "${resolution.entry.name}" is disabled`,
        };
      }

      if (error instanceof EngineError && error.code === "option_not_found") {
        const options = Array.isArray(error.details.options)
          ? error.details.options.filter((option): option is string => typeof option === "string")
          : [];

        return {
          ok: false,
          code: "invalid_request",
          message:
            options.length > 0
              ? `no option "${request.value ?? ""}"; available: ${options.join(", ")}`
              : `no option "${request.value ?? ""}"`,
        };
      }

      // A node can vanish between the snapshot and the action: a client-side
      // framework (Next.js, React) hydrates and replaces the DOM without a
      // navigation. The ref points at a backend node that no longer exists,
      // which is a stale ref, not an engine failure.
      if (error instanceof EngineError && error.code === "not_found") {
        return { ok: false, code: "stale_ref", current_doc: this.last?.doc ?? 0 };
      }

      if (error instanceof EngineError && error.code === "not_interactive") {
        const blocker = error.details.blockerBackendNodeId;

        if (typeof blocker !== "number") {
          // No occluder: the engine said why it refused (unfocusable target,
          // no layout box, outside the viewport). Carry the reason through
          // so the caller can retry or report meaningfully.
          return typeof error.details.reason === "string"
            ? { ok: false, code: "not_interactive", reason: error.details.reason }
            : { ok: false, code: "not_interactive" };
        }

        const entry = this.current?.byBackend.get(blocker);
        const dom = {
          ...(typeof error.details.blockerTag === "string"
            ? { blocker_tag: error.details.blockerTag }
            : {}),
          ...(typeof error.details.blockerText === "string"
            ? { blocker_text: error.details.blockerText }
            : {}),
          ...(typeof error.details.blockerDomId === "string"
            ? { blocker_dom_id: error.details.blockerDomId }
            : {}),
          ...(typeof error.details.blockerClass === "string"
            ? { blocker_class: error.details.blockerClass }
            : {}),
        };

        return entry === undefined
          ? { ok: false, code: "not_interactive", blocker_backend_node_id: blocker, ...dom }
          : {
              ok: false,
              code: "not_interactive",
              blocker_backend_node_id: blocker,
              blocker_ref: entry.ref,
              blocker_role: entry.role,
              blocker_name: entry.name,
              ...dom,
            };
      }

      throw error;
    }
  }

  /** Close the underlying browser. Safe to call more than once. */
  async close(): Promise<void> {
    await this.engine.close();
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
      return { do: "press", key: request.key, backendNodeId };
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
