# @abubakarsiddiik/compiler

## 0.2.5

### Patch Changes

- Updated dependencies [af07fa8]
  - @abubakarsiddiik/substrate@0.2.1
  - @abubakarsiddiik/runtime@0.1.6

## 0.2.4

### Patch Changes

- Updated dependencies [b724e84]
  - @abubakarsiddiik/substrate@0.2.0
  - @abubakarsiddiik/runtime@0.1.5

## 0.2.3

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
  - @abubakarsiddiik/runtime@0.1.4

## 0.2.2

### Patch Changes

- Updated dependencies [af649af]
  - @abubakarsiddiik/protocol@0.2.1
  - @abubakarsiddiik/runtime@0.1.3

## 0.2.1

### Patch Changes

- Updated dependencies [ee738c0]
  - @abubakarsiddiik/substrate@0.1.1
  - @abubakarsiddiik/runtime@0.1.2

## 0.2.0

### Minor Changes

- 099fe69: Add DOM-first map discovery and `portolan map build` / `map update`.
  
  - `@abubakarsiddiik/sources` discovers pages, links, and forms from the live DOM
    (states, `url` read ops, and typed form ops), and writes `draft.json` plus
    `tasks.json` next to the map versions.
  - `portolan map build --url ... [--start <cmd>] --verify --publish` discovers,
    verifies, and publishes; `portolan map update` refreshes an existing map and
    keeps ops discovery did not see.
  - `compiler` can bootstrap candidates from traces with no base map, and honours
    proposed names and summaries instead of dropping them.
  - `server` adds `open_url`: a mapless explore session that records a trace, and
    persists fallback and explore traces in the shipped stdio and HTTP servers.
  - Map states may be URL-only (no marks), which is what discovery can prove.
  - `map build/update` writes a `capabilities.json` ledger of every observed link,
    form, and button, reports coverage, and `--require-complete` refuses to publish
    while any capability is missing. `map coverage` and `map capability add|set`
    make the ledger the repeatable work queue for a coding agent.
  - `portolan auth login` saves a signed-in Playwright storage state; `--storage-state`
    (or `storageState` / `PORTOLAN_STORAGE_STATE`) lets discovery, verification,
    compilation, and the MCP runtime reach authenticated pages without Portolan ever
    seeing the password.

### Patch Changes

- Updated dependencies [099fe69]
  - @abubakarsiddiik/protocol@0.2.0
  - @abubakarsiddiik/runtime@0.1.1

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.

### Patch Changes

- Updated dependencies [05f2358]
- Updated dependencies [0f9570f]
  - @abubakarsiddiik/protocol@0.1.0
  - @abubakarsiddiik/model@0.1.0
  - @abubakarsiddiik/substrate@0.1.0
  - @abubakarsiddiik/runtime@0.1.0
