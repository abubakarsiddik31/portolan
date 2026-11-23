# @abubakarsiddiik/server

## 0.2.6

### Patch Changes

- 2976560: `portolan map status` shows where the mapping loop stands (version, coverage, recorded runs not yet compiled, the last build's failures grouped by reason, auth expiry, and the next command), and every build is journaled to `.portolan/state/builds.jsonl`. `portolan mcp` adds `map_status`, `map_gaps`, `capability_set`, `map_record_gaps`, `map_build` and `map_job`, so an MCP-only client can finish a map; the two that run a browser need `confirm: true`.
- 282b1c5: `portolan map record --gaps` records a one-click run for every missing button without an agent loop, writing traces tagged with the capability id. A build then covers exactly that capability, so matching no longer depends on a label two pages may share. `open_url` and `fallback_begin` accept an optional `capability` for the same link.
- Updated dependencies [1692e2e]
- Updated dependencies [9862d0a]
- Updated dependencies [05435df]
- Updated dependencies [71f3e62]
- Updated dependencies [282b1c5]
- Updated dependencies [3e3e5f2]
- Updated dependencies [fe40c0f]
  - @abubakarsiddiik/protocol@0.2.2
  - @abubakarsiddiik/runtime@0.1.7
  - @abubakarsiddiik/substrate@0.2.2

## 0.2.5

### Patch Changes

- af07fa8: Stop Chrome processes piling up and exhausting memory.
  
  - `open_site` and `open_url` now close the browser of the session they
    replace. Before, each new site left its Chrome running until exit.
  - Idle sessions' browsers are closed after `sessionTtlMs` in `portolan mcp`
    and `portolan serve`, not only their database rows.
  - `portolan mcp` and the QA MCP server exit when the client closes stdin, so
    a client that quits without signalling no longer orphans Chrome.
  - A launch that fails after Chrome starts now closes that Chrome.
  - Chrome starts with extensions, background networking, component updates,
    sync, and audio off.
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

- Updated dependencies [87d27fd]
  - @abubakarsiddiik/substrate@0.1.2
  - @abubakarsiddiik/runtime@0.1.4

## 0.2.2

### Patch Changes

- af649af: Keep every project file Portolan creates under `.portolan/`, with committed
  artifacts and an ignored `state/` directory in one place. Add
  `.portolan/config.json` discovery with a legacy `portolan.config.json`
  fallback, `portolan migrate`, and `.mcp.json` opt-in wiring for QA.
  
  Also fix `portolan --version`, `qa --help`, failed `absent` check details,
  `qa doctor` hints, and the missing-suite message.
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
  - @abubakarsiddiik/substrate@0.1.0
  - @abubakarsiddiik/runtime@0.1.0
