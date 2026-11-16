# Portolan — Substrate Spec (Layer 1: the stateful browser)

| | |
|---|---|
| **Date** | 2026-11-08 |
| **Status** | Spec for the layer **under** the site-map runtime. Extracted from `docs/archive/BUILD_PLAN_v1.md` after ADR-002. |
| **Role** | This is not the product. It is what maps are executed on, explored with, and repaired through: UI-tier ops run on its refs, the fallback agent uses its affordances, and the compiler learns from its traces. |

Section numbers are preserved from BUILD_PLAN v1 so the v1 adversarial review (`docs/archive/BUILD_PLAN_v1.md` §15) still resolves. Where ADR-002 changes a section, a note says so.

**What ADR-002 changes here**
- Affordances are now consumed mostly by the **fallback agent and the compiler**, not by every agent step. Token budget targets still apply to the fallback path.
- Refs are still scoped to `(sid, doc)`, but **ops never store refs**. Op programs store `(role, name, ctx, ordinal)` locators and resolve them to refs at run time.
- Trace capture (new, see `BUILD_PLAN.md` §6) hooks into `act`: every action records its locator, the pre/post semantic state, and the network requests it caused.
- `freeze`/`hibernate` stay post-gate.

---

## 3. Architecture

```
agent ──HTTP/JSON──▶ portolan-server (Fastify)
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

Lifecycle (`create`, `close`, `freeze`, `hibernate`, `wake`) lives in the **session manager**, not the adapter. That keeps the adapter honest: anything that can navigate, snapshot, dispatch input, and evaluate is a Portolan engine.

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

type PortolanError = {
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
- **The meter is diagnostic, not the headline.** It counts what Portolan sends with `cl100k_base`. The benchmark's dollar figures come from the model provider's billed `usage` (input, cached input, output), because that is what the buyer pays.

---
