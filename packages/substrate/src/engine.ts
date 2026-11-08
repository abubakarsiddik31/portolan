export type NavigateResult = {
  url: string;
  title: string;
  status: number | null;
};

export type Bounds = {
  /** CSS pixels, in document coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SemanticNode = {
  nodeId: string;
  role: string;
  name: string;
  /** CDP backend node id, used to dispatch an action. */
  backendNodeId?: number;
  ignored: boolean;
  /** False when ignored, unstyled, zero-sized, or hidden by CSS. */
  visible: boolean;
  bounds?: Bounds;
  properties: Record<string, string | number | boolean>;
  childIds: string[];
};

export type Snapshot = {
  /** Document epoch. Increments on every committed main-frame navigation. */
  doc: number;
  /** Mutation counter. Increments on every dispatched action. */
  v: number;
  url: string;
  title: string;
  nodes: SemanticNode[];
};

export type NetworkEffect = {
  kind: "network";
  method: string;
  url: string;
  status?: number;
};

export type NavigationEffect = {
  kind: "navigation";
  from: string;
  to: string;
  doc: number;
};

export type ValueEffect = {
  kind: "value";
  backendNodeId: number;
  value: string;
};

export type Effect = NetworkEffect | NavigationEffect | ValueEffect;

export type Action =
  | { do: "click" | "check" | "uncheck"; backendNodeId: number }
  | { do: "fill" | "select"; backendNodeId: number; value: string }
  | { do: "press"; key: string };

export type DispatchResult = {
  ok: true;
  doc: number;
  v: number;
  url: string;
  title: string;
  effects: Effect[];
};

export type EngineErrorCode =
  | "navigation_failed"
  | "not_found"
  | "not_interactive"
  | "evaluate_failed";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: EngineErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = "EngineError";
    this.code = code;
    this.details = options?.details ?? {};
  }
}

/**
 * The four-method browser adapter.
 *
 * This is the only place the runtime touches a rendering engine. Chromium is
 * the first implementation; Lightpanda or a remote CDP endpoint can implement
 * the same interface without changing the runtime.
 *
 * `snapshot` returns the accessibility tree merged with layout: role, name,
 * document bounds, and visibility. Ranking and refs are the next layer.
 */
export interface Engine {
  navigate(url: string): Promise<NavigateResult>;
  snapshot(): Promise<Snapshot>;
  dispatch(action: Action): Promise<DispatchResult>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}
