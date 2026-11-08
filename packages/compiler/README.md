# @portolan/compiler

From traces to verified ops. The compiler starts with the repair agent, because
the first traces come from finishing an intent that no op could serve.

## Repair agent

`repairIntent` completes one intent with the substrate verbs and a model over
`ModelPort`:

```ts
const result = await repairIntent({
  model,
  substrate,
  goal: "Search the catalog for socks and open the Merino Socks product page.",
  effect: "read",
  maxSteps: 12,
  check: async (view) => isOnProductPage(view),
});
```

The loop:

1. `view` captures the page and ranks affordances with refs.
2. The model returns one `act`, `view`, `read`, or `done`.
3. `act` resolves the ref, dispatches, and records effects and a delta.
4. `done` is accepted only when the optional `check` agrees.

The result carries the same `Trace` shape as a fallback scope: every view, act,
and read, with the locator, value, document and mutation counters, URL, state
before and after, effects, and delta. The compiler can treat a headless repair
exactly like a recorded run.

A failed act is fed back to the model but not recorded: a stale ref is a retry,
not a step in the intent.

## Segmenter

`segmentTrace(trace, map)` cuts a run at state and URL changes, then merges
pieces that belong to one op according to the map's `from`/`to` sets:

- **Store:** the five UI pieces map to `search`, `get_product`, `add_to_cart`,
  `open_checkout`, and `checkout`.
- **Wizard:** three step changes merge into one `submit_application`, because
  that op runs from `step1` to `done`.
- **Portal:** login and a same-state filter stay separate; the filter changes
  the URL even though the state stays `invoices`.

A candidate is only chosen when the from/to match is unique. When several ops
share the same boundaries, the segment is marked ambiguous and left for the
model.

`labelSegments({ model, map, segments })` asks the model once for a label per
segment: `reuse` an existing op, `extend` one, or `propose` a new one. The
deterministic candidate is a hint, not an answer.

## Parameterizer

`parameterizeTrace({ trace, params?, labels? }, map)` turns a segment into
params and constants:

- **A segment that matches an op** is parameterized against that op's
  signature. A typed value that fills a named param becomes a param; so does a
  URL path or query piece. Everything else stays a constant.
- **A segment with no op** is parameterized by its label and the task values.
- **`parameterizeTraces(inputs, map)`** diffs several traces of the same op. A
  value that changes between runs becomes a param, even when the first pass
  called it a constant.

The result carries `params`, `constants`, `missing` (required op params no
binding covered), and an inferred JSON Schema.

On the dev fixtures, the store's five ops and the portal's two ops match their
oracle signatures exactly. The wizard reports `file_path` as missing, because
the substrate cannot upload yet.

## Returns inference

`inferReturns(view)` reads the post-state and builds an extractor plus a JSON
Schema:

- **Rows first.** A repeated test id inside a table or grid is stronger
  evidence than a handful of scalar nodes. Table columns come from the header
  row; a `data-*` attribute on a cell is carried into the locator. Card rows
  group their descendants by role.
- **Fields next.** A node with a stable test id and a value becomes a field,
  e.g. `order-id` -> `order_id`.
- **None last.** A page with no data region returns `{ kind: "none" }`.

The inferred extractor is run against the same view before it is returned, so
an inference that does not extract is discarded.

`validateInferredReturns(inferred, view)` extracts and validates against the
schema. On the fixtures, store search rows and portal filter rows validate on
a held-back run with different data.

`nameReturns({ model, inferred })` asks the model to rename the keys. Names
must be unique snake_case and must exist in the inference; anything else is
rejected.

## URL lift

`liftUrl({ segment, returns })` builds a route from the post-state URL:

- A query value or path segment that equals a bound param becomes `{name}`.
- Empty query params are dropped, so a filter form's `q=` and `category=` do
  not end up in the route.
- A segment whose params never appear in the URL does not lift.

`withUrlLift(op, lift, returns)` replaces the op's `url` impl with the lifted
route and extractor. The store search lifts to `/search?q={query}` and the
portal filter to `/?status={status}`; both are run with a new param in the
bench test, not just compared as strings.

## HTTP lift

`liftHttp({ segment, returns, outcomeCheck })` rebuilds the non-GET requests
the trace captured:

- **Every 2xx write request** becomes a step with the same method, path, and
  body.
- **A bound param's value** becomes `{name}` in the URL and body.
- **A value from an earlier response that appears in a later request** becomes
  a `bind`, so a token or id can reach the next step.

`withHttpLift(op, lift, returns, outcomeCheck)` replaces the op's `http` impl
and records the check. The store add-to-cart lifts to
`POST /api/cart/items` with `view_cart` as `outcome_check`. The bench test
sends the request, loses the response, reconciles with `view_cart`, and
asserts the cart still has one item and the executor ran once.

## Verifier

`verifyOp({ map, op, paramSets, baseUrl })` runs every impl of an op on a
fresh browser context per param set:

- **At least three param sets.** Fewer is rejected before a browser starts.
- **Params are validated** against the op's schema.
- **The tier runs**: `url`, `http`, or `ui`. The `http` tier's post checks run
  against the page after the fetch, because a fetch does not navigate.
- **An `outcome_check`** runs after a write and must succeed.
- **The report is per impl**: each run's params, result, state, URL, and
  failure message. An op is verified when at least one impl passes every set.

On the fixtures, store search verifies on three fresh sessions, a wrong post
state is rejected with the run that broke, and a lifted `http` add-to-cart
verifies on three fresh carts with `view_cart` as its outcome check.

## Publisher

`publishMap({ dir, map, candidates })` writes the next `v<n>.json`:

- **A verified candidate** replaces an op of the same name or adds a new one.
- **An unverified candidate** is rejected and never written.
- **An irreversible op without `reviewed: true`** is held: it goes to
  `review/v<n>.json` and does not enter the map.
- **`compiled_from`** records only the traces that reached the map;
  `verified_at` is the publish time.

The new map is parsed with the same loader the runtime uses before it is
written, so the publisher cannot create a map the server will reject. The
result carries the version, path, map, diff, and review path.

## Local models

The repair role is provider-agnostic. Any OpenAI-compatible endpoint works:

```sh
PORTOLAN_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
PORTOLAN_LOCAL_MODEL=qwen2.5:7b-instruct \
pnpm vitest run bench/repair/repair.test.ts
```

Without those variables the live test skips and the scripted test still proves
the loop.
