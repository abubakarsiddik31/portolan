export type NavigateResult = {
  url: string;
  title: string;
  status: number | null;
};

export type AxNode = {
  nodeId: string;
  role: string;
  name: string;
  /** CDP backend node id, used to dispatch an action. */
  backendNodeId?: number;
  ignored: boolean;
  properties: Record<string, string | number | boolean>;
  childIds: string[];
};

export type Snapshot = {
  url: string;
  title: string;
  nodes: AxNode[];
};

export type Action =
  | { do: "click" | "check" | "uncheck"; backendNodeId: number }
  | { do: "fill" | "select"; backendNodeId: number; value: string }
  | { do: "press"; key: string };

export type DispatchResult = {
  ok: true;
  url: string;
  title: string;
};

export type EngineErrorCode =
  | "navigation_failed"
  | "not_found"
  | "not_interactive"
  | "evaluate_failed";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EngineError";
    this.code = code;
  }
}

/**
 * The four-method browser adapter.
 *
 * This is the only place the runtime touches a rendering engine. Chromium is
 * the first implementation; Lightpanda or a remote CDP endpoint can implement
 * the same interface without changing the runtime.
 *
 * `snapshot` returns the raw accessibility tree. Turning it into ranked
 * affordances and refs is the semantic engine's job, not the adapter's.
 */
export interface Engine {
  navigate(url: string): Promise<NavigateResult>;
  snapshot(): Promise<Snapshot>;
  dispatch(action: Action): Promise<DispatchResult>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}
