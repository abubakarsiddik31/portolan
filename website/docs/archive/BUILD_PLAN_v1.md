# Facet — Build Plan (v1, archived)

> **Archived.** Written when the project was named Facet; renamed to Portolan by ADR-004. Superseded by `docs/BUILD_PLAN.md` (v2) per ADR-002. Kept unchanged for the record, including the adversarial review in §15.

| | |
|---|---|
| **Date** | 2026-11-08 |
| **Status** | Plan for the first build session. Supersedes nothing; refines `PRD.md` §7–§13. **Revised 2026-11-08 after an adversarial review — findings and resolutions in §15.** |
| **Scope** | Engine selection, stack, architecture, protocol v0, semantic/delta design, hibernation correction, cost meter, benchmark harness, 10-day build order. |
| **Read first** | `README.md`, `PRD.md`, `docs/ANALYSIS.md` |

---

## 0. TL;DR — the decisions

| Decision | Choice | Why |
|---|---|---|
| **Language / runtime** | TypeScript on Node 24 LTS (minimum 22) | Playwright's reference API is TS; official MCP SDK is TS; one language for server, semantic layer, SDK, harness. |
| **HTTP server** | Fastify 5 + Zod 4 | Schema-first request/response validation, fast, mature plugin model, good for a long-running daemon. |
| **Engine (Tier 2)** | Playwright 1.65 + Chromium, behind the four-method adapter | Shortest path to real input, auto-wait, storageState, downloads, tracing. Chromium is the fidelity floor. |
| **Engine (Tier 1, later)** | Lightpanda 1.0 over CDP | 1.74M WPT subtests (~80% of Chrome), no layout/paint. Good for read/DOM-only, not for interaction. **AGPL-3.0 engine — legal review required.** |
| **Semantic layer** | CDP `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`, merged on `backendNodeId` | One batched capture gives roles, names, states, layout bounds, computed styles, and paint order. |
| **Ref resolution** | `ref → backendNodeId` map; resolve with `DOM.resolveNode`; dispatch real input with `Input.*` | Refs are ours, not an undocumented selector engine. Real input events survive more sites than synthetic `.click()`. |
| **Delta engine** | Diff the semantic projection, not HTML | Keeps post-action payload ≤15% of a full snapshot. |
| **State** | SQLite (`better-sqlite3`) + filesystem artifacts | No Redis in v1. Sessions are local; snapshots are files. |
| **Meter** | `js-tiktoken` (cl100k_base) + wall clock + payload bytes + optional RSS | Reproducible by hand; model variance documented. |
| **Benchmark** | 12 held-out fixtures + 8 pinned real tasks + 3 dev fixtures; three arms (browser-use as shipped, common runner + agent-browser, common runner + Facet) | Real-site-only is not reproducible. The agent-browser arm isolates Facet's contribution from the runner's. |
| **First deliverable** | Baseline token breakdown on 3 dev fixtures → 5x ceiling check → protocol + meter → semantic layer | Instrument before optimizing. If the ceiling or the table shows <5x, stop. |

**The mechanism, stated correctly:** Facet wins by making each step's observation small (affordances, deltas, short refs), and that needs state on the server. It does **not** remove the agent's conversation history; the harness owns that. See §15 F1–F2 and the ADR-001 amendment.

**The one spec correction that matters:** hibernation cannot be both ~15ms wake and ≥95% RSS freed on Chromium. See §7. Split `freeze` from `hibernate` and update PRD G4/R1. Neither mode is measured by the go/no-go, so both move after the gate.

**The session model is decided:** stateful default, `ephemeral` compatibility mode. The full argument, rejected alternatives, and revisit triggers are in [`DECISIONS.md`](./DECISIONS.md) (ADR-001).

---

## 1. Research findings (verified 2026-11-08)

### 1.1 Open-source browser and automation options

| Project | License | Signal | What it actually gives us | Verdict |
|---|---|---|---|---|
| **Playwright** (microsoft/playwright) | Apache-2.0 | 99.5k★, v1.65, Node ≥20 | Chromium/Firefox/WebKit, auto-wait, input dispatch, `storageState`, downloads, tracing, CDP session access, `ariaSnapshot()` | **Primary engine.** Use it. |
| **Playwright MCP** (microsoft/playwright-mcp) | Apache-2.0 | 39.3k★ | A11y-tree snapshots + `ref`-based tools; the closest prior art to Facet's surface | **Borrow the shape, not the dependency.** It is snapshot-per-step, no effects, no deltas, no hibernation. |
| **agent-browser** (vercel-labs) | Apache-2.0 | 47.1k★, Rust CLI + daemon, direct CDP | Compact a11y text with `@e1` refs, stateful sessions, profiles, idle-state save | **Prior art + comparison baseline.** Not a library; shelling out per step loses in-process CDP access. |
| **Lightpanda** (lightpanda-io/browser) | **AGPL-3.0** engine; Apache-2.0 npm wrapper | 41.6k★, 1.0 released 2026-10-02, 1.74M WPT subtests (~80% of Chrome), CORS on by default | Fast, low-memory, drives via Puppeteer/Playwright/Selenium/CDP; **no graphical rendering or layout** | **Tier 1 candidate, later.** Licensing and missing layout block it as the default. |
| **browser-use** | MIT | 120k★, Python | Full agent loop over Playwright, DOM extraction via CDP, cost teardown target | **Baseline.** Keep it in Python, isolated from the core. |
| **Stagehand** (browserbase) | MIT | 26.0k★ | `observe()` / `act()` / `extract()`; LLM in the loop for action discovery | **API-shape reference only.** Facet's affordances must be deterministic and LLM-free. |
| **Puppeteer** | Apache-2.0 | Mature | Chromium-only, thinner than Playwright | Rejected as primary: no multi-browser, weaker auto-wait/storageState. |
| **Raw CDP** | Protocol | — | Maximum control | Rejected as primary: we would rebuild navigation, waiting, input, auth, downloads. Used *inside* Playwright. |
| **Servo / Ladybird** | MPL-2.0 / various | Experimental | Not automation-ready in 2026 | Skip. |

### 1.2 Technical facts that shape the design

1. **`page.ariaSnapshot()` returns YAML** (role, name, attributes, nesting) but **no `backendNodeId`**. It is useful for a v0 dump, not for stable refs.
2. **`Accessibility.getFullAXTree`** returns AX nodes with `role`, `name`, `properties` (checked/disabled/expanded/focused/level/…), and `backendDOMNodeId`. This is the spine of the semantic model.
3. **`DOMSnapshot.captureSnapshot({ computedStyles })`** returns the DOM tree, layout bounds, paint order, and computed styles in one call. This is how we decide *visible*, *in viewport*, *covered*, and *clickable*.
4. **`DOM.resolveNode` + `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `DOM.setFileInputFiles`** give real input at coordinates, after a `scrollIntoView` and a hit-test. This is the "browser owns timing" rule, implemented.
5. **`Page.captureSnapshot`** returns MHTML including iframes, shadow DOM, external resources, and inline styles — a DOM snapshot, **not a JS heap**.
6. **`Page.setWebLifecycleState('frozen' | 'active')`** freezes JS/timers but **does not free renderer memory**. This is the crux of §7.
7. **Lightpanda has no layout or paint.** DOM, HTML, Fetch, cookies, events, workers, Shadow DOM, IndexedDB, XPath, WebSockets, forms, CORS are covered; CSS/layout/SVG are the bulk of the WPT gap. Consequence: `getBoundingClientRect`, visibility, hit-testing, and screenshots are weak or absent. Lightpanda is a **read/DOM-only Tier 1**, never the default for checkout flows.
8. **`agent-browser` proves the ref pattern works** at 200–400 tokens per snapshot vs 3,000–5,000 for raw DOM. That is the token budget we are aiming at, before deltas.
9. **Lightpanda 1.0 is real** — out of beta, production users, `npm install @lightpanda/browser`, native MCP server. The PRD's "partial CDP/V8 coverage" is now out of date. The blocker is layout, not JS.

### 1.3 What this changes in the existing docs

- **Engine assumption:** Lightpanda is closer than the PRD assumed. It becomes a credible Tier 1 in P1, not a P4 science project.
- **Hibernation:** the PRD's 15ms/95% pair is physically inconsistent on Chromium. Correct it now.
- **Meter:** `{tokens, ms, mb}` is underspecified. `mb` must be defined as payload size, with `rss_mb` separate.
- **Protocol:** the README's "five verbs" and Appendix A's eight verbs need reconciling. `view?since=v` is the delta-on-demand verb and deserves a first-class slot.

---

## 2. Stack

| Layer | Choice | Version | Why this, not the alternative |
|---|---|---|---|
| Runtime | Node.js | 24 LTS (min 22) | `better-sqlite3` requires ≥22; Playwright requires ≥20. One runtime for server + tooling. |
| Package manager | pnpm workspaces | 9+ | Fast, strict, good monorepo ergonomics. Turborepo only if build times hurt. |
| Language | TypeScript | 5.7+ | Types shared across protocol, engine, SDK, harness. |
| HTTP | Fastify | 5.x | Schema-first, fast, mature. Hono is the alternative if edge deploy matters later. |
| Validation | Zod | 4.x | Runtime validation + inferred types + OpenAPI generation. |
| Engine | `playwright-core` + Chromium | 1.65 | Do not bundle browsers in the npm package; `npx playwright install chromium`. |
| CDP | Playwright `newCDPSession(page)` | — | No extra dependency; full protocol access per page. |
| Semantic | `Accessibility` + `DOMSnapshot` + `DOM` domains | — | Batched capture, no per-element round trips. |
| Markdown | `@mozilla/readability` + `turndown` | latest | Battle-tested extraction; strip nav/ads/footer before conversion. |
| Tokenizer | `js-tiktoken` | 1.0.x | cl100k_base reference count; pure JS, no native build. |
| Storage | `better-sqlite3` | 13.x | Synchronous, fast, zero-ops. Sessions, snapshots metadata, results. |
| Artifacts | Filesystem | — | MHTML, uploads, downloads, traces. Never in the token path. |
| Logging | `pino` | latest | Fastify-native, structured. |
| Testing | `vitest` + Playwright Test | latest | Unit + integration; fixtures double as benchmark sites. |
| Baseline | Python 3.12 + `browser-use` | pinned | Isolated venv in `bench/baseline`; invoked by the harness. |
| MCP (P1) | `@modelcontextprotocol/sdk` | 1.32.x | Official TS SDK. Thin wrapper over the HTTP verbs. |
| Packaging | `tsup` (or `tsc`) + Docker | — | Single `facetd` binary/entrypoint; Docker image with Chromium for hosted runs. |

**Rejected:** Python core (weaker MCP/type-sharing; the baseline stays Python), Rust/Zig engine (rejected in the PRD, still correct), Redis (premature), Postgres (premature), GraphQL (wrong shape for verbs).

---

## 3. Architecture

```
agent ──HTTP/JSON──▶ facetd (Fastify)
                       ├── session manager      create / fork / freeze / hibernate / wake
                       ├── semantic engine      AX+DOM capture → affordances, refs, ranking
                       ├── delta engine         semantic diff → effects + changed refs
                       ├── read engine          Readability → markdown, budgeted
                       ├── policy               egress allowlist, scoped creds, untrusted text
                       ├── meter                tokens / ms / payload MB / RSS
                       └── engine adapter       navigate | snapshot | dispatch_input | evaluate
                                                  ├── playwright-chromium (Tier 2, default)
                                                  └── lightpanda (Tier 1, P1)
```

### 3.1 Engine adapter (the four methods)

```ts
export interface EngineAdapter {
  navigate(s: EngineSession, url: string, opts: NavOpts): Promise<NavResult>;
  snapshot(s: EngineSession, opts: SnapshotOpts): Promise<RawSnapshot>;
  dispatchInput(s: EngineSession, action: ResolvedAction): Promise<InputResult>;
  evaluate<T>(s: EngineSession, fn: string, args?: unknown[]): Promise<T>;
}
```

Lifecycle (`create`, `close`, `freeze`, `hibernate`, `wake`) lives in the **session manager**, not the adapter. That keeps the adapter honest: anything that can navigate, snapshot, dispatch input, and evaluate is a Facet engine.

```ts
export interface RawSnapshot {
  url: string;
  title: string;
  readyState: "complete" | "partial";
  docVersion: number;
  viewport: { w: number; h: number; scrollX: number; scrollY: number };
  ax: AXNode[];          // Accessibility.getFullAXTree
  dom: DomSnapshot;      // DOMSnapshot.captureSnapshot (layout + styles)
  frames: FrameInfo[];
}
```

### 3.2 Request flow

**`goto`**
1. `adapter.navigate(url)` → wait for load + quiescence (§5.1).
2. `adapter.snapshot()` → AX tree + DOMSnapshot + layout.
3. Semantic engine merges, filters, ranks, assigns refs.
4. Serialize to budget; attach `meter`; return `v`, `affordances`, `reading_ref`.

**`act`**
1. Check `v` and resolve `ref → backendNodeId`.
2. `scrollIntoView` → `DOM.getBoxModel` → hit-test (`DOM.getNodeForLocation`) → dispatch real input. If the hit-test lands on another node (cookie banner, overlay), do not click through: return `not_interactive` with `blocker_ref`.
3. Wait for quiescence (§5.1 rules, `capMs` 1,500ms for `act`). A 300ms cap would return deltas before most SPA fetches land and push the agent into an extra `view` step.
4. Snapshot → diff against the previous semantic projection → `effects` + `delta`.
5. Attach `meter`; return the new `v`.

**`read`**
1. Use the current DOM (no navigation).
2. Readability on the main frame → Turndown → strip nav/ads/footer → dedupe.
3. Truncate to `budget` at a paragraph boundary; report `truncated`.

**`sleep` / `wake`** — see §7.

### 3.3 Session model

- A session is `{ sid, profile, context, page, docVersion, refMap, history, createdAt, lastUsedAt, state }`.
- `state ∈ {live, frozen, hibernated, closed}`.
- One Chromium **browser process** per host, one **context** per session, one **page** per session (tabs in P1).
- Profiles persist cookies/localStorage/IndexedDB in a per-profile directory; `storageState` is the portable form.
- Sessions are addressed by `sid`; snapshots by `sn_*`; both are rows in SQLite with a filesystem blob.

---

## 4. Protocol v0

Reconcile the README and Appendix A: **five product verbs** (`goto`, `act`, `read`, `sleep`, `wake`) plus **three plumbing verbs** (`sessions.create`, `view`, `history`). The eight-verb Appendix A is the wire surface; the five-verb README is the mental model.

| Verb | Method | Request | Response |
|---|---|---|---|
| `sessions.create` | `POST /v1/sessions` | `{ profile?, viewport?, block?, session?: "stateful" \| "ephemeral", steps?: Step[] }` | stateful: `{ sid, ready, meter }`; ephemeral: `{ results[], meter }` |
| `goto` | `POST /v1/s/{sid}/goto` | `{ url, budget? }` | `{ doc, v, url, title, ready, affordances[], reading_ref, omitted, meter }` |
| `act` | `POST /v1/s/{sid}/act` | `{ ref, do, value?, key?, files?, v? }` | `{ doc, v, ok, effects[], delta[], stale?, meter }` |
| `read` | `GET /v1/s/{sid}/read?ref=&budget=` | — | `{ markdown, truncated, tokens, meter }` |
| `view` | `GET /v1/s/{sid}/view?since=v&budget=` | — | `{ v, affordances[], delta[], effects[], omitted, meter }` |
| `history` | `POST /v1/s/{sid}/history` | `{ op: "back" \| "forward" }` | `{ v, url, affordances[], meter }` |
| `sleep` | `POST /v1/s/{sid}/sleep` | `{ mode?: "freeze" \| "hibernate" }` | `{ snapshot, mode, freed_mb, meter }` |
| `wake` | `POST /v1/sessions/wake` | `{ snapshot }` | `{ sid, v, ready, ms, meter }` |

### 4.1 Core types

```ts
type Affordance = {
  ref: string;                 // "e12" — scoped to (sid, doc); see §4.2
  do: ActionVerb;
  label: string;               // accessible name, truncated
  ctx?: string;                // nearest row/card/heading/fieldset label, truncated; only when label alone is ambiguous
  kind?: "primary" | "secondary" | "nav" | "destructive" | "field";
  value?: string;              // current value for inputs/selects
  state?: "checked" | "disabled" | "expanded" | "selected" | "required";
};

type Effect =
  | { type: "nav"; to: string }
  | { type: "modal"; label: string }
  | { type: "menu"; label: string }
  | { type: "validation"; ref?: string; message: string }
  | { type: "toast"; message: string }
  | { type: "dialog"; kind: "alert" | "confirm" | "prompt"; message: string }
  | { type: "download"; filename: string; artifact: string }
  | { type: "network_pending"; count: number }
  | { type: "dom_only"; changes: number };

type Meter = {
  tokens: number;              // cl100k_base count of the response body (pre-meter)
  ms: number;                  // wall time, request received → response serialized
  mb: number;                  // payload size, bytes / 1e6
  rss_mb?: number;             // session process RSS, when measurable
  cost_usd?: number;           // tokens × configured price
  tokens_method: "cl100k_base";
};

type FacetError = {
  code: "stale_ref" | "not_interactive" | "blocked" | "needs_auth" | "captcha"
      | "timeout" | "engine_crash" | "budget_exceeded" | "bad_request";
  message: string;
  recovery?: string;           // suggested next call
  current_v?: number;
  new_ref?: string;
  blocker_ref?: string;        // not_interactive: the node that intercepted the hit-test
};
```

### 4.2 Semantics that must be pinned down

- **`doc`** is the document epoch. It increments on navigation, `history`, and `wake`. **Refs are scoped to `(sid, doc)`**: a ref stays valid across in-page mutations for as long as the stability contract (§5.5) holds.
- **`v`** is the mutation counter within a document. It increments on any `act` that mutates the document and is the base for `view?since=v`. It is **not** the ref scope. (Scoping refs to `v` would invalidate every ref after every click, which contradicts the stability contract.)
- **`act.v`** is optional and optimistic: if sent and older than the current `v`, the server still resolves the ref but marks the response `stale: true` so the agent knows its view was out of date.
- **`ready: "partial"`** means quiescence hit the cap; the agent may proceed but should expect churn.
- **`omitted`** is always present when the budget truncated the list. Never silently trim.
- **Errors are typed and recoverable.** `stale_ref` returns `current_v` and, when a match exists, `new_ref`.
- **Meter is on every response**, including errors. Count the body *before* attaching the meter (avoids self-reference); document that rule in the SDK.
- **`ephemeral`** mode creates a session, runs an ordered `steps[]` batch (e.g. `goto` then `act` then `read`), returns one result per step, and tears down. One verb is not enough: even the simplest real task is `goto` + `act`. It is the adoption bridge, not the default. Built after the gate.

---

## 5. Semantic engine

This is the product. The browser is rentable; the quality bar here is not.

### 5.1 Quiescence (the browser owns timing)

Do not trust `networkidle` alone. Settle when **all** hold, or when the cap fires:

1. `document.readyState === "complete"`.
2. No in-flight `Network.requestWillBeSent` without a matching `loadingFinished`/`loadingFailed` for `quietMs` (250ms).
3. No DOM mutations (`MutationObserver`, main frame) for `mutationMs` (150ms).
4. No pending `requestAnimationFrame` storm (optional, P1).
5. Hard cap `capMs` (3,000ms) → `ready: "partial"`.

Track network via CDP events; track mutations with one injected observer. Cache the tier decision per domain (P1).

### 5.2 Capture and merge

1. `Accessibility.getFullAXTree` → AX nodes.
2. `DOMSnapshot.captureSnapshot({ computedStyles: ["display","visibility","opacity","pointer-events","cursor","position","overflow"] })` → DOM + layout + styles.
3. Merge on `backendNodeId`. Drop AX nodes with no DOM node (unless they are useful text).
4. Compute per node: `visible` (display/visibility/opacity/size), `inViewport` (intersection of bounds and viewport), `covered` (hit-test at center returns a different node), `interactive` (role or handler or cursor).

### 5.3 Actionable filter

Keep:
- ARIA/HTML interactive roles: `button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `combobox`, `listbox`, `option`, `menuitem`, `tab`, `switch`, `slider`, `spinbutton`, `file`, `dialog`.
- Elements with `onclick`, `role`, `tabindex >= 0`, `contenteditable`, or `cursor: pointer`.
- Visible, non-disabled, in the main frame or a reachable iframe.

Drop: hidden, `aria-hidden`, zero-size, offscreen-and-not-scrollable, pure layout wrappers, duplicate labels within the same container.

Disambiguate repeated labels across containers with `ctx`. A product grid with twelve "Add to cart" buttons is useless to an agent without the product name next to each. Derive `ctx` from the nearest ancestor with an accessible name (row, `article`, `listitem`, `fieldset`/`legend`, card heading). Emit it only when `label` is not unique on the page, so it costs tokens only where it buys success rate.

Report disabled elements as affordances with `state: "disabled"` — the agent should know they exist.

### 5.4 Ranking

Score = weighted sum of:
- `kind` (primary/secondary/nav/destructive/field),
- `inViewport` (1.0) vs scrollable (0.4),
- `changedSinceLastV` (boost),
- `semanticRole` quality (button > generic clickable div),
- `label` quality (non-empty, short, not "click here"),
- `formRelevance` (near the focused field or the current step).

Sort descending; truncate to budget; report `omitted`.

### 5.5 Refs

```ts
type RefEntry = {
  ref: string;             // "e" + base36(hash(role|name|ordinal|framePath)).slice(0,4)
  backendNodeId: number;
  frameId: string;
  role: string;
  name: string;
  ordinal: number;         // nth match of (role, name) in document order
};
```

- `ref` is scoped to `(sid, doc)` (§4.2). It is **not** a CSS selector and **not** a Playwright locator.
- **Collisions:** 4 base36 characters is ~1.68M values. A page with 500 actionable nodes has roughly a 7% chance of at least one collision (birthday bound). On collision, extend the colliding ref by one character, deterministically by document order. Unit-test this with a forced-collision hash.
- Resolution: `DOM.resolveNode({ backendNodeId })` → `Runtime.callFunctionOn` to scroll into view and return the box → `DOM.getNodeForLocation` to hit-test → `Input.dispatchMouseEvent` at the center.
- **Stability contract:** a ref survives re-render if `(role, name, ordinal)` still resolves to a visible node in the same document. If it does not, return `stale_ref` with `current_v` and, when a fuzzy match exists, `new_ref`. Do not promise more than that; measure the survival rate instead.
- On navigation, all refs are invalid. `v` increments.

### 5.6 Budget

- Count tokens with the same tokenizer as the meter.
- Drop lowest-ranked affordances until under `budget`; then serialize.
- Always return `omitted` and `tokens`. Never exceed `budget`.
- Target: p50 ≤ 800 tokens for `affordances` (PRD G1); `agent-browser`'s 200–400 for a bare a11y snapshot is the floor, deltas push the average down.

### 5.7 `read`

- Main frame only (P0); iframes in P1.
- `@mozilla/readability` on a cloned document → `turndown` → strip nav/header/footer/aside → dedupe repeated blocks.
- Truncate at a paragraph boundary; `truncated: true`.
- `reading_ref` from `goto` points at this document; `read?ref=` re-reads a section.

### 5.8 How we know it works

"≥95% of interactive elements correctly identified" is only meaningful with a predicate. Define it as:

> On the 20 held-out tasks, for each task, the union of affordances returned across all steps contains a valid action for every human-annotated required interaction, and no more than 5% of returned affordances are non-interactive or duplicate.

Annotate the 20 tasks once; store the annotation alongside the task spec. Measure precision and recall separately.

---

## 6. Delta and effect engine

### 6.1 Diff

- Keep the previous semantic projection (the normalized node list, not the HTML).
- After an action, capture again; diff by `(role, name, ordinal)` and by `backendNodeId` where it survives.
- Emit:
  - `added`: new actionable nodes → `delta` entries.
  - `removed`: refs that disappeared → `{ ref, removed: true }`.
  - `changed`: label/value/state changes → `{ ref, ... }`.
- Non-actionable structural changes collapse into `effects` or `dom_only` with a count. Never ship the full tree.

### 6.2 Effect classification

| Effect | Detection |
|---|---|
| `nav` | URL changed, or main-frame `Page.frameNavigated` |
| `modal` | `role=dialog` / `alertdialog` became visible |
| `menu` | `role=menu` / `listbox` became visible |
| `validation` | `aria-invalid`, `:invalid`, or error text bound to a field |
| `toast` | `aria-live` region appeared/changed, or a short-lived banner |
| `dialog` | `Page.javascriptDialogOpening` |
| `download` | Playwright `download` event / `Page.downloadWillBegin` |
| `network_pending` | In-flight requests at settle time |
| `dom_only` | Structural change with no semantic effect |

### 6.3 Target and measurement

- `delta` payload ≤15% of a full affordance snapshot (PRD R4). Measure per **non-navigating** action (a navigation's delta is a full snapshot by definition), report p50/p95, fail CI above 25%.
- Track `actions per intent` (≤1.2) by annotating the intended action in the task spec and counting retries.

---

## 7. Hibernation — corrected

### 7.1 The physics

- Chromium cannot serialize a live renderer's JS heap to disk and restore it. `Page.captureSnapshot` gives **MHTML**: DOM, iframes, shadow DOM, inline styles, resources. It does **not** restore JS state, timers, WebSocket connections, or in-flight requests.
- `Page.setWebLifecycleState("frozen")` stops JS and timers but keeps the renderer process and its memory. Wake is fast because nothing was freed.
- To actually free memory you must close the page/context. Wake is then a new renderer + navigation + state restore.

So the PRD's "wake ≤50ms p50" and "frees ≥95% of session RSS" cannot both be true on Chromium. Pick one per mode.

### 7.2 Two modes

| Mode | Mechanism | RSS freed | Wake p50 | Use |
|---|---|---|---|---|
| **`freeze`** | `Page.setWebLifecycleState("frozen")`; renderer stays alive | ~0% | 10–30ms | Short idles, same host, interactive sessions |
| **`hibernate`** | Serialize state, close page/context, release renderer | ≥95% of renderer RSS | 300–800ms | Long idles, scale-to-zero, cost control |

Default: `hibernate` for sessions idle >5 minutes; `freeze` for <5 minutes. The agent chooses explicitly; the server may auto-hibernate on a timer.

### 7.3 Snapshot contents

```ts
type HibernationSnapshot = {
  sid: string;
  profile: string;
  url: string;
  docVersion: number;
  viewport: { w: number; h: number };
  storageState: unknown;        // cookies + localStorage (+ IndexedDB where supported)
  mhtml: string;                // Page.captureSnapshot
  scroll: { x: number; y: number };
  forms: Array<{ ref: string; role: string; name: string; value: string }>;
  history: Array<{ url: string; scroll: { x: number; y: number } }>;
  refMap: RefEntry[];
  createdAt: string;
};
```

`mhtml` is **not** used to restore the page; Chromium cannot rehydrate a working page from it. It is kept for the audit log and for offline `read` while hibernated. Drop it from the snapshot if disk cost matters.

### 7.4 Wake sequence

1. New context with `storageState`.
2. Navigate to `url`; wait for quiescence.
3. Restore scroll and form values via `evaluate`, matching fields by `(role, name, ordinal)`. Old refs are not valid in the new document, so they cannot be the key.
4. Restore the history stack logically (URLs + scroll; back/forward replays).
5. Re-capture the semantic model; bump `doc`.
6. Return `refs_restored: false`, `restored: "exact" | "approximate" | "failed"`, and a fresh affordance list.

### 7.5 What `hibernate` cannot restore — say so in the API

Waking re-navigates to a URL. So anything that lives only in the JS heap or in the result of a POST is lost: SPA in-memory state, multi-step wizard state held client-side, a checkout page reached by form submission, open WebSockets. Re-navigating to a POST-result URL may 404, redirect, or resubmit.

- Track the method of the last main-frame navigation. If it was not a GET, or the page has unsaved form state that the restore cannot reproduce, `sleep({mode:"hibernate"})` returns `hibernate_unsafe` with `recovery: "freeze"`. The agent can force it.
- `wake` reports `restored: "approximate"` when the post-wake semantic model differs materially from the pre-sleep one.
- The PRD's "resume exactly where it left off" holds for `freeze` only. For `hibernate` it means "resume from the last safe URL with cookies, storage, scroll, and form values."
- The 300–800ms wake target is fixture-relative. On a real site, wake is bounded by that site's load time, which we don't control.

### 7.6 PRD changes

- **G4** becomes: "`freeze` wakes ≤50ms; `hibernate` frees ≥95% of renderer RSS with wake ≤800ms on fixtures."
- **R1** acceptance splits the same way, and adds `hibernate_unsafe` and `restored`.
- **§1.2 / §2** ("cost grows quadratically", "O(n²) collapses to O(n)") are restated per §15 F1: the win is per-step observation size, which needs server state.
- **JTBD "resume exactly where it left off"** is qualified per §7.5.
- If a partner needs 15ms wake *and* memory reclaim, that is a different architecture (snapshot the process, e.g., CRIU), and it is out of scope for P0.

---

## 8. Cost meter

The meter is the product's credibility. Define it exactly.

| Field | Definition | Method |
|---|---|---|
| `tokens` | Token count of the response body the agent receives, **before** the meter is attached | `js-tiktoken`, `cl100k_base`, stable key order |
| `ms` | Wall time from request received to response serialized | `performance.now()`, integer |
| `mb` | Payload size of the response body | UTF-8 bytes / 1e6, 3 decimals |
| `rss_mb` | Session process RSS after the call (optional) | `process.memoryUsage().rss` or `ps` for the browser |
| `cost_usd` | `tokens × price_per_1m / 1e6` | Price table versioned in config |
| `tokens_method` | `"cl100k_base"` | Documented; model tokenizers vary ±5–15% |

Rules:
- Count the body **without** `meter` to avoid self-reference; then attach. Document this in the SDK.
- Deterministic serialization: stable key order, no timestamps, no random IDs inside counted content.
- Golden test: a fixture response must re-count to the same `tokens` on every run.
- Report `steps`, `tokens/step`, and `$ / completed task` in the benchmark; the meter is the input, the table is the output.
- **The meter is diagnostic, not the headline.** It counts what Facet sends with `cl100k_base`. The benchmark's dollar figures come from the model provider's billed `usage` (input, cached input, output), because that is what the buyer pays.

---

## 9. Benchmark harness

### 9.0 Ceiling check — before any Facet code (Day 1)

The 5x gate is a ratio of whole-task costs, not of observation sizes. Every step also pays for a system prompt, the task goal, the agent's own action log, and **output** tokens (priced ~5x input). Facet shrinks only the observation term. If those fixed costs are a large share of the baseline's bill, 5x is arithmetically out of reach no matter how good the semantic layer is.

1. Run pinned `browser-use` on the 3 dev fixtures with provider usage capture.
2. Split each step's billed tokens into: system prompt + tools, goal, history, current observation, output. Record cached vs uncached input.
3. Compute the ceiling: replace the observation term with 300 tokens/step (the `agent-browser` floor), keep everything else, apply caching, and divide.
4. **Gate 0:** if the ceiling is under ~6x, 5x is not reachable with our margin for error. Stop, or reframe the target (steps, latency, success rate) **before** building.

Also confirm on the pinned version how `browser-use` handles history: whether it re-sends prior page states or only the current one plus its own outputs. The cost story depends on the answer (§15 F1).

### 9.1 Task spec

```yaml
id: checkout-01
category: checkout
start: http://127.0.0.1:4100/store
goal: Buy one "Blue / M" tee and reach the confirmation page.
max_steps: 25
fixture: store
success:
  url_matches: "/checkout/confirmation"
  dom: "!!document.querySelector('[data-order-id]')"
  extracted:
    order_id: "[data-order-id]"
```

- `success` is a conjunction: URL regex, optional JS expression in the page, optional extracted value.
- `fixture` pins the task to a local site; omit it for a real-site task.
- Every task is annotated with the human-required interactions (for precision/recall and `actions per intent`).

### 9.2 The 20 tasks

| Category | Count | Examples |
|---|---|---|
| Checkout | 4 | add to cart, variant select, coupon, confirmation |
| Form fill | 4 | multi-step signup, validation recovery, file upload, date picker |
| Dashboard read | 4 | filter a table, read a metric, export CSV, paginate |
| Multi-page research | 4 | search → open 3 results → extract a fact |
| Auth-gated flow | 4 | login, session persist, logout, re-auth |

**12 fixtures + 8 real.** The PRD says "20 real tasks"; that is not reproducible. Fixtures are modeled on the real flows and versioned with the repo; the 8 real tasks satisfy the "real workload" gate. Report the two cohorts separately and combined.

**Held out.** These 20 tasks are the test set. The semantic engine is developed and tuned only on **3 separate dev fixtures** (a store, a multi-step form, a data table). We write both the fixtures and the engine, so tuning on the test set would measure our own overfitting. Freeze the Facet commit before the N=5 run and record its SHA in `results.jsonl`.

**Real auth-gated tasks** use test accounts we own on sites whose terms allow automation. No personal accounts, no credentials in the repo; inject them from the environment.

### 9.3 Arms

| Arm | Agent loop | Browser interface | What it answers |
|---|---|---|---|
| **A — status quo** | `browser-use` as shipped | `browser-use`'s own DOM + screenshot state | "Is Facet cheaper than what people run today?" (the headline) |
| **B — free alternative** | Common runner (§9.4) | `agent-browser` snapshot with `@e` refs | "Is Facet cheaper than a free compact-snapshot tool with the **same** loop?" |
| **C — Facet** | Common runner (§9.4) | Facet affordances + deltas | The product |

A alone cannot attribute the win: a different loop, prompt, and history policy all change cost. **B vs C isolates Facet's contribution**, since only the browser interface differs. If C beats A by 5x but B by under 1.5x, the product is the runner, and a free tool plus a good loop gets most of the value. That is a kill signal (`ANALYSIS.md` §8).

Arm A: `browser-use` (MIT), pinned version, Python 3.12, isolated venv. Arms B and C: the TS runner. All arms capture per-step usage from the provider response (`input`, `cached_input`, `output`), not estimates. Cost = billed tokens × the same price table (cache reads at the provider's cached rate) + browser cost (local = 0; if cloud, include it).

### 9.4 Common runner (arms B and C)

- A minimal agent loop: observe → choose an action → act → repeat. One prompt template; only the tool descriptions and observation format differ between B and C.
- **History policy is a parameter, identical across B and C.** Run both policies:
  - `full`: every prior tool result stays in the conversation, which is what a typical tool-use harness does.
  - `last1`: only the latest observation plus a compact action log.
- Facet's per-step observation is smaller under either policy, and the gap is largest under `full`. The headline uses `full`, because that is how buyers' harnesses behave by default. `last1` is reported as a second row, not substituted for it.
- Prompt caching **on** for all arms, matching production. Report a caching-off row as a sensitivity check.
- Record every Facet response's `meter` and the model's usage.

### 9.5 Fairness rules (write these down before running)

1. Same model id and temperature for all arms.
2. Same `max_steps` and same wall-clock cap.
3. Same task goal text; different observation/action interfaces.
4. Same success predicate, evaluated by the harness, not the agent.
5. No human intervention; failures count as failures.
6. No retries of a failed task in the headline number; report retries separately.
7. Browser cost is zero for all arms (local). If any arm uses a cloud browser, include it and say so.
8. No arm may call another arm's tools.
9. B and C share the runner, prompt template, and history policy; only the browser interface differs.
10. The Facet commit is frozen before the run; no tuning on the 20 held-out tasks.
11. `read`/`view` calls count as steps and their tokens count as cost. The agent gets no free observations.

### 9.6 Metrics and statistics

| Metric | Definition | Target |
|---|---|---|
| Success rate | pass@1 over N runs | ≥ baseline − 2pts |
| $ / completed task | per task: total $ across all N runs ÷ successful runs (∞ if none); then median across tasks | ≥5x better than A; report vs B too |
| tokens / step | p50, p95 | p50 ≤800 |
| steps / task | median | ≤ baseline − 30% |
| actions / intent | retries per annotated intent | ≤1.2 |
| delta payload ratio | delta tokens / full snapshot tokens | ≤15% |
| goto→ready | p50, p95 | p50 ≤900ms |

- N = 5 runs per task per arm (100 runs/arm). Report median and a bootstrap 95% CI, **resampling tasks** (not runs). Runs within a task are correlated, so resampling runs overstates confidence.
- The 5x gate is on **median $/completed task** as defined above, so failed runs' spend is charged to the successes. Also report mean and p95 so a single outlier cannot hide. Tasks with zero successes in an arm are reported as a count, not dropped.
- If the CI includes 2x, the result is not 5x. Do not round up.

### 9.7 Output

```
bench/results/2026-11-XX/
  results.jsonl        # one row per run
  table.md             # the single table from README §Definition of done
  table.csv
  traces/              # optional Playwright traces for failures
```

`pnpm bench` must reproduce the table from a clean checkout, given the same model key.

---

## 10. Repository layout

```
facet/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker/
│   └── facetd.Dockerfile        # Node 24 + Chromium
├── packages/
│   ├── protocol/                # Zod schemas, types, error codes, client SDK
│   ├── core/                    # engine adapter, semantic, delta, read, meter
│   ├── facetd/                  # Fastify server, session manager, routes
│   └── cli/                     # `facet serve`, `facet bench`, `facet mcp` (P1)
├── bench/
│   ├── tasks/                   # 20 held-out YAML specs + annotations; dev/ for the 3 dev tasks
│   ├── fixtures/                # local sites + static server (dev fixtures separate)
│   ├── baseline/                # arm A: Python browser-use runner + requirements.txt
│   ├── runner/                  # arms B/C common loop, orchestrator, scoring, table generation
│   └── results/
└── docs/
    ├── ANALYSIS.md
    └── BUILD_PLAN.md
```

Start with four packages, not ten. Split `core` into `semantic`/`delta` only when the file sizes justify it. Premature package boundaries are a tax.

---

## 11. Build order (10 focused working days)

| Day | Deliverable | Acceptance |
|---|---|---|
Ordered so the cheapest falsifier runs first. Nothing the go/no-go doesn't measure is built before it.

| Day | Deliverable | Acceptance |
|---|---|---|
| **1** | Workspace, fixture server, 3 **dev** fixtures, arm A (`browser-use`) running on them with provider usage capture; ceiling analysis (§9.0) | Per-step token breakdown recorded; history behavior confirmed; ceiling computed. **Gate 0: ceiling <~6x → stop or reframe.** |
| **2** | `protocol` schemas (verbs, errors, meter, `doc`/`v`), Fastify skeleton, `EngineAdapter` + Playwright/Chromium, `sessions.create`, `goto` returning a raw AX dump | Malformed input returns typed `bad_request`; a real page loads; `goto` returns URL, title, `doc`, `v`, raw tree; session closes cleanly. |
| **3** | Semantic v0: AX+DOMSnapshot merge, actionable filter, `ctx`, refs (+collision handling), ranking, budget | On the 3 dev fixtures, every required interaction appears with an unambiguous label or `ctx`; p50 ≤800 tokens; `omitted` reported. |
| **4** | `act`: ref resolution, scroll/hit-test/input, `blocker_ref`, quiescence, stale detection; `view` delta v0 | Click/type/select/scroll/key work on dev fixtures; stale ref returns `stale_ref` + `new_ref`; refs survive in-page mutation. |
| **5** | Effects + delta measurement; `read` (Readability+Turndown); meter on every route | Delta ≤15% on non-navigating acts; `read` returns clean markdown; meter golden test passes. |
| **6** | Common runner (§9.4) with arm B (`agent-browser`) and arm C (Facet) backends; history policy + caching flags | Arms B and C complete the 3 dev tasks; usage recorded per step. |
| **7** | 12 held-out fixture tasks + 8 pinned real tasks, annotations, scoring, `table.md` generator | `pnpm bench --dry` runs all arms on all 20 tasks once and writes `results.jsonl`. |
| **8** | Pilot: N=1 all arms. Fix **harness** bugs only. Freeze the Facet commit. | Every arm/task pair produces a scored row; Facet SHA recorded. |
| **9** | N=5 run, all arms, both history policies | 100 runs/arm/policy complete; raw results committed. |
| **10** | Analysis, go/no-go | Table shows success, $/task (vs A and vs B), tokens/step, steps/task, p50 latency, with task-resampled CIs. **If <5x vs A, or <1.5x vs B, stop.** |

Days 6–8 are where slips will land. If Day 5 runs over, cut the real-task cohort to 4 before cutting any fairness rule.

**After the gate (only on go):** `freeze` + `hibernate`/`wake` with §7.5 semantics, profile persistence, `ephemeral` batches, MCP wrapper.

**P1 (weeks 3–4):** Lightpanda Tier 1 behind the same adapter (after legal review), tabs/history, artifacts, audit log, per-domain tier cache.

**P2:** fork-from-warm, multi-agent sessions, WebMCP passthrough, vision fallback, hosted concurrency.

---

## 12. Risks and open decisions

| Risk / decision | Impact | Recommendation |
|---|---|---|
| **Stateful vs stateless default** | Shapes the protocol and adoption | **Decided: stateful default**, `session: "ephemeral"` compatibility mode. See ADR-001. |
| **Hibernation target is physically inconsistent** | Wasted engineering, broken promises | Adopt the freeze/hibernate split (§7); update PRD G4/R1. |
| **Meter `mb` is ambiguous** | Benchmark disputes | `mb` = payload size; `rss_mb` = memory. Document it. |
| **Lightpanda is AGPL-3.0** | Licensing exposure if hosted | Keep behind the adapter, separate process, out of the default path until counsel clears it. The npm wrapper is Apache-2.0; the engine is not. |
| **Lightpanda has no layout** | Weak visibility/hit-testing | Tier 1 = read/DOM-only. Never the default for checkout. |
| **Semantic layer generalizes poorly** | The 5x dies | Measure precision/recall per category; the fixtures expose regressions early. |
| **Benchmark fairness** | Results not credible | Write the fairness rules down before running; same model/prompt/steps; publish the harness. |
| **Real-site drift** | Flaky benchmark | 12 fixtures + 8 pinned real tasks; record the page snapshot with each real run. |
| **Prompt injection via page text** | Security | Treat all labels as untrusted data; never execute page text; policy layer restricts egress and credentials. |
| **Token price deflation** | Savings pitch weakens | Report steps and latency alongside $; steps fall slower than prices. |
| **Ref churn on React/SPA re-renders** | Retries, cost | Measure survival rate; return `stale_ref` + `new_ref`; do not over-promise. |
| **Fixed per-step costs cap the ratio** | 5x unreachable regardless of engine quality | Ceiling check on Day 1 (§9.0); Gate 0. |
| **Win belongs to the runner, not Facet** | Free tools + a good loop match us | Arm B (§9.3); kill if C/B <1.5x. |
| **Overfitting to fixtures we wrote** | Inflated result that fails on real sites | 3 dev fixtures for tuning; 20 held out; frozen commit. |
| **`hibernate` loses JS/POST state** | Broken resume promise | `hibernate_unsafe`, `restored` field, `freeze` for exact resume (§7.5). |

---

## 13. What we are not building (P0)

- A rendering engine, or a Chromium fork.
- A human-facing browser UI.
- A crawl/search platform.
- An LLM inside the semantic loop. Affordances are deterministic; the LLM is the agent, not the extractor.
- Vision fallback.
- Hosted multi-tenant infrastructure, billing, or per-browser-hour pricing.
- The MCP wrapper before the HTTP verbs work.
- Fork-from-warm, multi-agent sessions, WebMCP passthrough.

---

## 14. Sources

Retrieved 2026-11-08. Versions and licenses change; re-verify before shipping.

**Engines and automation**
- Playwright — https://playwright.dev/ (v1.65, Apache-2.0, Node ≥20)
- Playwright aria snapshots — https://playwright.dev/docs/aria-snapshots
- Playwright MCP — https://github.com/microsoft/playwright-mcp (Apache-2.0)
- agent-browser — https://github.com/vercel-labs/agent-browser, https://agent-browser.dev/ (Apache-2.0)
- Lightpanda 1.0 — https://lightpanda.io/blog/posts/lightpanda-1-0 (2026-10-02)
- Lightpanda repo — https://github.com/lightpanda-io/browser (AGPL-3.0)
- browser-use — https://github.com/browser-use/browser-use (MIT)
- Stagehand — https://github.com/browserbase/stagehand (MIT)

**Protocol and APIs**
- Chrome DevTools Protocol, Page domain — https://chromedevtools.github.io/devtools-protocol/tot/Page/
  - `Page.captureSnapshot`, `Page.setWebLifecycleState`
- CDP Accessibility domain — https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- CDP DOMSnapshot domain — https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
- CDP Input domain — https://chromedevtools.github.io/devtools-protocol/tot/Input/
- Web Lifecycle — https://github.com/WICG/web-lifecycle/

**Stack**
- Fastify — https://fastify.dev/
- Zod — https://zod.dev/
- js-tiktoken — https://github.com/dqbd/tiktoken
- better-sqlite3 — https://github.com/WiseLibs/better-sqlite3
- MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk
- Mozilla Readability — https://github.com/mozilla/readability
- Turndown — https://github.com/mixmark-io/turndown

**Prior research**
- `docs/ANALYSIS.md` §3–§5 (market, cost model, competitive landscape)
- `PRD.md` §6–§13 (verbs, architecture, requirements, gates, phases)

---

## 15. Adversarial review (2026-11-08)

A deliberate attempt to break this plan before spending ten days on it. Each finding records the attack, whether it held, and where the plan changed. Severity reflects the damage if we had not caught it.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| **F1** | **The cost table is linear, not quadratic.** `ANALYSIS.md` §4.3 computes 15,000 × 30 = 450k and 300 × 30 = 9k. The whole 40x is per-step observation size, which contradicts the text under it ("the mechanism is not smaller pages"). | High (core claim was internally inconsistent) | `ANALYSIS.md` §4.3, README, and ADR-001 rationale #1 restated: the mechanism is per-step observation size, which needs server state. PRD §1.2/§2 queued in §7.6. |
| **F2** | **Facet doesn't own the agent's history.** The quadratic term lives in the caller's conversation. A stateful browser doesn't stop a harness from keeping every prior tool result; with deltas the sum is Σk·d, which is still quadratic with a smaller constant. The original Facet runner dropped history while the baseline didn't, so part of any win would be the runner's. | High (headline could not be attributed) | History policy is a shared parameter across arms B and C, run both ways; `full` is the headline (§9.4). |
| **F3** | **Fixed per-step costs can make 5x impossible.** System prompt, tool schemas, goal, action log, and output tokens (~5x price) don't shrink. If they're half the baseline bill, the ceiling is about 2x. | High (could waste ten days) | Day 1 ceiling check and Gate 0 (§9.0). |
| **F4** | **No arm isolated Facet from free alternatives.** Beating `browser-use` doesn't show we beat `agent-browser` or Playwright MCP plus a decent loop. ADR-001 itself names those as the thing a stateless Facet would collapse into. | High | Arm B (common runner + `agent-browser`); kill if C/B <1.5x (§9.3). |
| **F5** | **Overfitting.** We write the fixtures and tune the engine on them; the old plan tuned on 3 of the 12 benchmark fixtures. | High | 3 separate dev fixtures; 20 held out; frozen commit (§9.2; §9.5 rule 10). |
| **F6** | **Build order instrumented last.** The TL;DR said "instrument before optimizing", but the baseline arrived on Day 8, after the semantic engine. | Medium | Baseline and ceiling on Day 1 (§11). |
| **F7** | **Hibernation was built before the gate, which never measures it.** | Medium | Moved after the gate (§11). |
| **F8** | **`hibernate` can't deliver "resume exactly where it left off."** Wake re-navigates, so JS heap state, POST results, and client-side wizards are lost. `mhtml` was in the snapshot but never used to restore. Form restore was keyed by refs that are invalid after wake. | Medium | §7.5: `hibernate_unsafe`, `restored`, fields matched by `(role, name, ordinal)`, `mhtml` scoped to audit/offline read; PRD JTBD qualified. |
| **F9** | **Ref scope contradicted ref stability.** Refs were scoped to `(sid, v)` while `v` increments on every mutating act, so every click would invalidate every ref, yet §5.5 promised refs survive re-renders. | Medium | Split `doc` (navigation epoch, ref scope) from `v` (mutation counter) (§4.2). |
| **F10** | **Ref collisions.** 4 base36 chars over ~500 nodes gives ~7% chance of a collision per page. | Low–Medium | Deterministic extension on collision + forced-collision test (§5.5). |
| **F11** | **Ambiguous affordances.** Twelve "Add to cart" buttons are indistinguishable without the product name. Bare labels trade success rate for tokens, and the gate punishes success loss harder. | Medium | `ctx` field, emitted only when the label isn't unique (§4.1, §5.3). |
| **F12** | **`$ / completed task` was incoherent:** "median over successful runs; failures in the denominator" can't both hold. | Medium | Per task: total $ ÷ successes; median across tasks; bootstrap over tasks (§9.6). |
| **F13** | **300ms `act` quiescence cap.** Most SPA fetches land after it, so deltas would be premature and the agent would pay an extra `view` step. | Low–Medium | `capMs` 1,500ms for `act`, with `network_pending` reported (§3.2). |
| **F14** | **Hit-testing found covered elements but didn't say what to do.** | Low | `not_interactive` + `blocker_ref`; never click through (§3.2). |
| **F15** | **One-verb `ephemeral` is useless.** Real tasks need at least `goto` + `act`. | Low | `ephemeral` takes a `steps[]` batch (§4.2). |
| **F16** | **Prompt caching was ignored.** Re-sent prefixes bill at a fraction of input price, which shrinks history cost and changes the ratio. | Medium | Caching on for all arms; caching-off as a sensitivity row (§9.4). |
| **F17** | **`read`/`view` could be free observations.** Content tasks need `read`, which costs a step and tokens. | Low | Fairness rule 11 (§9.5). |

### Attacks that did not hold

- **"Stateful is the wrong default."** It survives, for a different reason than first given: deltas and short stable refs need a server-held "before," and those are what make observations small. ADR-001 is amended, not reversed.
- **"Playwright is the wrong engine."** No better option for P0. The adapter keeps it swappable.
- **"The meter's `cl100k_base` count is wrong for Claude."** True, and it doesn't matter. The meter is diagnostic; dollars come from billed usage (§8).
- **"Lightpanda's AGPL blocks the business."** Not for P0; it stays out of the default path until counsel clears it.

### Residual risks we accept

- **Ten days is tight.** Days 6–8 carry the most risk. The cut order is fixed in advance: real-task cohort first, fairness rules never.
- **Twenty tasks is a small sample.** Task-resampled CIs will be wide. A result whose CI includes 2x is reported as not-5x.
- **The ceiling check uses the `agent-browser` floor as a stand-in for Facet.** If Facet's real observations are larger, the true ceiling is lower. That makes Gate 0 a necessary condition, not a sufficient one.
