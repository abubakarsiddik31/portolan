# @abubakarsiddiik/portolan

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
  - @abubakarsiddiik/sources@0.2.0
  - @abubakarsiddiik/compiler@0.2.0
  - @abubakarsiddiik/protocol@0.2.0
  - @abubakarsiddiik/server@0.2.0
  - @abubakarsiddiik/skills@0.1.1
  - @abubakarsiddiik/qa@0.1.2
  - @abubakarsiddiik/runtime@0.1.1

## 0.1.1

### Patch Changes

- 0ddb4a0: Add qa_generate and qa_repair, completing the QA package's M2 surface:
  generate turns a loose spec or a recorded trace into a draft case (goto steps
  from route changes, semantic steps from located acts, secret-looking fill
  values become env references), and repair recovers a moved or renamed target
  from a failed run by name similarity, rewrites the case as a draft, records a
  selector drift event, and confirms with one run. Both write through the same
  draft path as qa_case_write; only qa_verify promotes.
- Updated dependencies [0ddb4a0]
  - @abubakarsiddiik/qa@0.1.1

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.
- 0f9570f: Add local, agent-first QA: a deterministic test runner with a local SQLite
  store, database-derived verification, MCP tools and CLI commands, and case
  files that compose UI steps and map ops. The substrate gains an optional
  viewport screenshot for evidence.

### Patch Changes

- Updated dependencies [05f2358]
- Updated dependencies [0f9570f]
  - @abubakarsiddiik/protocol@0.1.0
  - @abubakarsiddiik/substrate@0.1.0
  - @abubakarsiddiik/compiler@0.1.0
  - @abubakarsiddiik/runtime@0.1.0
  - @abubakarsiddiik/server@0.1.0
  - @abubakarsiddiik/skills@0.1.0
  - @abubakarsiddiik/qa@0.1.0
