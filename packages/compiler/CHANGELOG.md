# @abubakarsiddiik/compiler

## 0.3.0

### Minor Changes

- 730069f: An `http` op can now authenticate the way the site's own frontend does. The impl takes an optional `auth` that points at where the page keeps its token (`localStorage`, `sessionStorage` or a cookie, with an optional JSON path), so a write to an API on another origin sends `Authorization: Bearer ...` instead of failing with 401. The map stores the location, never the token, and the op fails with `auth_missing` when the token is gone. `map build` records the location from the requests it captures.
- ed7603d: Ops keep their context. A recorded or discovered op used to be "click Save" with no sign of which page, which panel or which record, so an agent could not tell two `delete` buttons apart or know what a call would change. An op now has an optional `context` (the goal it was recorded for, the page, the named panel, the row it acts on, and what happened when it ran: the API calls and the messages shown). Discovery reads it from the page's structure, and the same label in two panels is now two capabilities instead of one. The compiler keeps the run's story, and a summary that would say only "Recorded: click Save." becomes the goal. `open_site` and the tool descriptions show it, and `map lint` warns about a bare parameterless `ui` op. Also fixes an `http` op compiled from a recording dropping its `auth`.

### Patch Changes

- d0b420d: `portolan compile` now verifies each candidate before it publishes, as the docs always said. Reads use the recorded values plus variants; a write runs only with `--verify-writes` and a `--params` file of at least three sets. A step the map does not cover is named from its recorded actions instead of failing with "no candidate ops", and a new write compiles to a `ui` op unless `--outcome-checks` names the read that proves it. `map build` takes `--outcome-checks` too.
- 7b21b90: Verification is faster. Identical param sets run once and an op with no required params needs one run. `map build --verify` runs reads side by side (`--concurrency`, default 4) while writes stay serial, and skips ops already verified against the same app build (`--app-version`, or a hash of the served HTML; `--reverify` to force). A `map update` that finds nothing new now says so instead of failing with "nothing verified".
- 1692e2e: `map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
- 9862d0a: Verification no longer launches a Chrome per run. `verifyOp` opens one browser and an isolated context per run, and `map build` shares a single browser across every op it verifies, so a build stops spawning dozens of Chrome processes.
- 71f3e62: This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.
  
  A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.
- 3e3e5f2: A recorded `ui` step whose control name carries data (`Active 1`, `Delete a@x.com`) is located by a `name_re` pattern instead of the recorded text, so the op keeps working when the count or the row changes.
- 0eed231: A recorded write with no outcome check now compiles to a `ui` write candidate instead of being dropped, so `map build` can verify it with `--verify-writes`. A write segment is named after the click that made the request, not the last click on the confirmation dialog.
- Updated dependencies [49b8cc6]
- Updated dependencies [730069f]
- Updated dependencies [9c8d776]
- Updated dependencies [1692e2e]
- Updated dependencies [9862d0a]
- Updated dependencies [ed7603d]
- Updated dependencies [05435df]
- Updated dependencies [71f3e62]
- Updated dependencies [282b1c5]
- Updated dependencies [3e3e5f2]
- Updated dependencies [fe40c0f]
  - @abubakarsiddiik/substrate@0.3.0
  - @abubakarsiddiik/protocol@0.3.0
  - @abubakarsiddiik/runtime@0.2.0

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
