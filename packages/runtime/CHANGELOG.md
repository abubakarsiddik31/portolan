# @abubakarsiddiik/runtime

## 0.1.7

### Patch Changes

- 1692e2e: `map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
- 282b1c5: `portolan map record --gaps` records a one-click run for every missing button without an agent loop, writing traces tagged with the capability id. A build then covers exactly that capability, so matching no longer depends on a label two pages may share. `open_url` and `fallback_begin` accept an optional `capability` for the same link.
- Updated dependencies [1692e2e]
- Updated dependencies [9862d0a]
- Updated dependencies [05435df]
- Updated dependencies [71f3e62]
- Updated dependencies [3e3e5f2]
- Updated dependencies [fe40c0f]
  - @abubakarsiddiik/protocol@0.2.2
  - @abubakarsiddiik/substrate@0.2.2

## 0.1.6

### Patch Changes

- Updated dependencies [af07fa8]
  - @abubakarsiddiik/substrate@0.2.1

## 0.1.5

### Patch Changes

- Updated dependencies [b724e84]
  - @abubakarsiddiik/substrate@0.2.0

## 0.1.4

### Patch Changes

- 87d27fd: Settle client-rendered pages before verifying or resolving `ui` ops, so a
  locator is not read from the empty shell at `domcontentloaded`.
  
  - The verifier navigates a fresh session with `substrate.goto`, which waits for
    quiescence, instead of the engine's early `navigate`.
  - `runUiOp` settles and retries the initial state, step locators, awaited
    states, postconditions, and extraction when the first capture misses, so a
    `call` on a just-navigated page no longer races hydration.
- Updated dependencies [87d27fd]
  - @abubakarsiddiik/substrate@0.1.2

## 0.1.3

### Patch Changes

- Updated dependencies [af649af]
  - @abubakarsiddiik/protocol@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [ee738c0]
  - @abubakarsiddiik/substrate@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [099fe69]
  - @abubakarsiddiik/protocol@0.2.0

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.

### Patch Changes

- Updated dependencies [05f2358]
- Updated dependencies [0f9570f]
  - @abubakarsiddiik/protocol@0.1.0
  - @abubakarsiddiik/substrate@0.1.0
