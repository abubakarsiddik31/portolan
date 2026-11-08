import type { Action, Engine, Snapshot } from "./engine.js";
import { EngineError } from "./engine.js";
import { type RefMap, RefRegistry } from "./refs.js";

export type SubstrateView = {
  snapshot: Snapshot;
  refs: RefMap;
};

export type ActRequest = {
  ref: string;
  do: "click" | "check" | "uncheck" | "fill" | "select" | "press";
  value?: string;
  key?: string;
};

export type ActResult =
  | { ok: true; doc: number; url: string; title: string }
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
 * resolves a ref, dispatches through the engine (which hit-tests and waits
 * for quiescence), and maps engine failures back to the substrate's typed
 * errors.
 */
export class Substrate {
  private readonly registry = new RefRegistry();
  private current: RefMap | undefined;

  constructor(private readonly engine: Engine) {}

  async view(): Promise<SubstrateView> {
    const snapshot = await this.engine.snapshot();
    const refs = this.registry.build(snapshot.nodes, snapshot.doc);
    this.current = refs;

    return { snapshot, refs };
  }

  async act(request: ActRequest): Promise<ActResult> {
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
      return { ok: true, doc: result.doc, url: result.url, title: result.title };
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
