# @abubakarsiddiik/runtime

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
