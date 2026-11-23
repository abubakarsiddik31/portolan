---
"@abubakarsiddiik/substrate": patch
"@abubakarsiddiik/runtime": patch
"@abubakarsiddiik/compiler": patch
---

Settle client-rendered pages before verifying or resolving `ui` ops, so a
locator is not read from the empty shell at `domcontentloaded`.

- The verifier navigates a fresh session with `substrate.goto`, which waits for
  quiescence, instead of the engine's early `navigate`.
- `runUiOp` settles and retries the initial state, step locators, awaited
  states, postconditions, and extraction when the first capture misses, so a
  `call` on a just-navigated page no longer races hydration.
