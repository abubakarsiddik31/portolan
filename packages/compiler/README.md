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

## Local models

The repair role is provider-agnostic. Any OpenAI-compatible endpoint works:

```sh
PORTOLAN_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
PORTOLAN_LOCAL_MODEL=qwen2.5:7b-instruct \
pnpm vitest run bench/repair/repair.test.ts
```

Without those variables the live test skips and the scripted test still proves
the loop.
