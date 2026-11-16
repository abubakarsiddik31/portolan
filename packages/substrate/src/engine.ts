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
  /** The author's stable automation hook, when the node has one. */
  test_id?: string;
  /** DOM attributes for this node, when it has a layout box. */
  attributes?: Record<string, string>;
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
  resource_type?: string;
  mime_type?: string;
  /** Parsed JSON request body, when the request had one. */
  request_body?: unknown;
  /** Parsed JSON response body, when the response had one. */
  response_body?: unknown;
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
  | { do: "press"; key: string; backendNodeId?: number };

export type DownloadInfo = {
  /** Server-local path the download was saved to. */
  path: string;
  /** The filename the site suggested. */
  filename: string;
};

export type DispatchResult = {
  ok: true;
  doc: number;
  v: number;
  url: string;
  title: string;
  effects: Effect[];
  download?: DownloadInfo;
};

export type EngineErrorCode =
  | "navigation_failed"
  | "not_found"
  | "not_interactive"
  | "disabled"
  | "option_not_found"
  | "file_input_not_found"
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
 *
 * **Quiescence contract.** `navigate` and `dispatch` resolve only after the
 * page has gone quiet: a navigation is committed and the DOM has stopped
 * changing within an implementation budget. An SPA that hydrates late, or a
 * click that triggers a data fetch and a re-render, is settled before these
 * return, so a snapshot taken right after them is current. Budget
 * exhaustion is not an error; the method resolves with whatever is on the
 * page at that moment, which is the pre-contract behavior. An action that
 * changes only local state (a menu toggle) may still resolve immediately.
 */
export interface Engine {
  /** Navigate and wait for the page to go quiet. */
  navigate(url: string): Promise<NavigateResult>;
  snapshot(): Promise<Snapshot>;
  /** Dispatch an action and wait for the page to go quiet. */
  dispatch(action: Action): Promise<DispatchResult>;
  /** Set files on a file input, or on the nearest file input to a trigger. */
  setFiles(backendNodeId: number, files: string[]): Promise<void>;
  /** The current value of a form control, or undefined when it has none. */
  readValue(backendNodeId: number): Promise<string | undefined>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}
