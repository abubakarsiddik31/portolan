/**
 * TypeScript view of a site map, kept in lockstep with `schema.ts`.
 *
 * The JSON Schema is the source of truth: a map is validated with Ajv before
 * these types are trusted. The test suite validates a fully populated fixture
 * so a schema change that is not mirrored here fails loudly.
 */

/** A JSON Schema object, as used for op params, returns, and entities. */
export type JsonSchema = Record<string, unknown>;

export type Effect = "read" | "write" | "irreversible";

export type OpStatus = "verified" | "degraded" | "broken";

/**
 * A semantic locator.
 *
 * Never a CSS selector and never a ref: refs die with the document, and
 * selectors encode styling. A locator resolves against the live semantic
 * model at call time. Use exactly one of:
 *
 * - `role` (+ `name` / `name_re`) for anything with an accessible role
 * - `label` for a form field, resolved like `getByLabel`
 * - `test_id` for a stable hook the app author publishes for automation
 *
 * `test_id` is not a CSS selector: it is an intentional, stable contract.
 */
export type Locator = {
  role?: string;
  label?: string;
  name?: string;
  name_re?: string;
  /** Human hint for disambiguation, e.g. "product card". */
  ctx?: string;
  ordinal?: number;
  test_id?: string;
  /** Which value to read. Only meaningful inside an extractor. */
  attr?: "name" | "value" | "text" | "href";
  /** Read an arbitrary DOM attribute by name, e.g. `data-status`. */
  attribute?: string;
  /**
   * Applied to the extracted string; the first capture group, or the whole
   * match when there is none, becomes the value. Used to pull an id out of a
   * URL, e.g. `/p/([^/]+)$` on `/p/p_101`.
   */
  pattern?: string;
};

export type FieldExtractor = {
  kind: "fields";
  fields: Record<string, Locator>;
};

export type RowsExtractor = {
  kind: "rows";
  container: Locator;
  row: Locator;
  cols: Record<string, Locator>;
};

/** Scalar fields and one row list, for results like `{ subtotal, items[] }`. */
export type CompositeExtractor = {
  kind: "composite";
  fields?: Record<string, Locator>;
  rows?: {
    /** Key the row array is returned under. */
    as: string;
    container: Locator;
    row: Locator;
    cols: Record<string, Locator>;
  };
};

/** Pull a value out of the last HTTP response body. */
export type JsonExtractor = {
  kind: "json";
  /** Dot path into the body; empty means the whole body. */
  path?: string;
};

/** The op's result is the file the browser downloaded. */
export type DownloadExtractor = {
  kind: "download";
};

/** The op returns an empty object, e.g. sign-in. */
export type NoneExtractor = {
  kind: "none";
};

export type Extractor =
  | FieldExtractor
  | RowsExtractor
  | CompositeExtractor
  | JsonExtractor
  | DownloadExtractor
  | NoneExtractor;

export type WebmcpImpl = {
  tier: "webmcp";
  tool: string;
};

export type UrlImpl = {
  tier: "url";
  /** A route template, e.g. `/search?q={query}`. */
  route: string;
  extract: Extractor;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type HttpStep = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Bind a value for a later step: CSRF tokens, ids, nonces. */
  bind?: Record<string, string>;
};

export type HttpImpl = {
  tier: "http";
  steps: HttpStep[];
  extract: Extractor;
};

export type UiStep =
  | { do: "click" | "check" | "uncheck"; target: Locator }
  | { do: "fill" | "select"; target: Locator; value: string }
  | { do: "press"; key: string }
  | { do: "await_state"; state: string; timeout_ms?: number };

export type UiImpl = {
  tier: "ui";
  steps: UiStep[];
  extract: Extractor;
};

export type Impl = WebmcpImpl | UrlImpl | HttpImpl | UiImpl;

export type PostCheck =
  | { kind: "url"; pattern: string; search?: string }
  | { kind: "state"; state: string }
  | { kind: "exists"; locator: Locator }
  | { kind: "absent"; locator: Locator }
  | { kind: "text"; locator: Locator; contains: string };

export type StateDef = {
  id: string;
  /** URLPattern-style path, e.g. `/p/:id`. */
  url?: string;
  /** Must be present to be in this state. */
  marks: Locator[];
  /** Must be absent, e.g. no login form. */
  not?: Locator[];
};

export type OpDef = {
  name: string;
  version: number;
  summary: string;
  params: JsonSchema;
  returns: JsonSchema;
  from: string[];
  to: string[];
  post: PostCheck[];
  effect: Effect;
  /** Name of a read op that proves whether a write happened. */
  outcome_check?: string;
  /** Irreversible ops require the caller to pass `confirm: true`. */
  confirm?: boolean;
  /** The author checked that this op needs no postcondition, so `post: []` is on purpose. */
  no_post?: boolean;
  /** In preference order. Only verified impls are used. */
  impls: Impl[];
  status: OpStatus;
};

export type AuthDef = {
  state: string;
  login_op: string;
};

export type SiteMap = {
  site: string;
  origins: string[];
  version: number;
  states: StateDef[];
  ops: OpDef[];
  entities: Record<string, JsonSchema>;
  auth?: AuthDef;
  compiled_from: string[];
  verified_at: string;
};
