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

## Local models

The repair role is provider-agnostic. Any OpenAI-compatible endpoint works:

```sh
PORTOLAN_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
PORTOLAN_LOCAL_MODEL=qwen2.5:7b-instruct \
pnpm vitest run bench/repair/repair.test.ts
```

Without those variables the live test skips and the scripted test still proves
the loop.
