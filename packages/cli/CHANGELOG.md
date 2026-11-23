# @abubakarsiddiik/portolan

## 0.2.3

### Patch Changes

- Updated dependencies [87d27fd]
  - @abubakarsiddiik/substrate@0.1.2
  - @abubakarsiddiik/runtime@0.1.4
  - @abubakarsiddiik/compiler@0.2.3
  - @abubakarsiddiik/server@0.2.3
  - @abubakarsiddiik/qa@0.1.5
  - @abubakarsiddiik/sources@0.2.3
  - @abubakarsiddiik/skills@0.1.4

## 0.2.2

### Patch Changes

- af649af: Keep every project file Portolan creates under `.portolan/`, with committed
  artifacts and an ignored `state/` directory in one place. Add
  `.portolan/config.json` discovery with a legacy `portolan.config.json`
  fallback, `portolan migrate`, and `.mcp.json` opt-in wiring for QA.
  
  Also fix `portolan --version`, `qa --help`, failed `absent` check details,
  `qa doctor` hints, and the missing-suite message.
- Updated dependencies [af649af]
  - @abubakarsiddiik/qa@0.1.4
  - @abubakarsiddiik/protocol@0.2.1
  - @abubakarsiddiik/server@0.2.2
  - @abubakarsiddiik/compiler@0.2.2
  - @abubakarsiddiik/runtime@0.1.3
  - @abubakarsiddiik/skills@0.1.3
  - @abubakarsiddiik/sources@0.2.2

## 0.2.1

### Patch Changes

- ee738c0: Fix QA process hangs, repair on minimal cases, and map coverage on refresh.
  
  - `@abubakarsiddiik/substrate`: `Substrate.close()` closes the underlying
    browser. The QA runner and repair paths already called an optional `close()`;
    without it, every `qa run`, `qa verify`, and `qa repair` printed results and
    then hung with a leaked Chromium process.
  - `@abubakarsiddiik/qa`: rehydrate stored case specs through the schema so
    optional arrays (`setup`, `expect`, `tags`) exist even for rows written from a
    minimal file. `qa repair` no longer fails with "steps is not iterable" on a
    case that omits `setup`. The installed skill also stops telling agents to
    call a nonexistent `qa_doctor` MCP tool and lists the real tool surface.
  - `@abubakarsiddiik/portolan`: `map build/update` keeps a live capability
    `mapped` when the published map already has an op for it, instead of marking
    it missing after a refresh. `qa init` now tells the agent to read the skill.
    The setup prompt and the installed `portolan-map` skill make building and
    syncing the map the goal, cover a codebase-less agent that inventories by
    browsing the live app, and distinguish its own browser (reconnaissance) from
    Portolan-recorded runs (compilable traces).
- Updated dependencies [ee738c0]
  - @abubakarsiddiik/substrate@0.1.1
  - @abubakarsiddiik/qa@0.1.3
  - @abubakarsiddiik/compiler@0.2.1
  - @abubakarsiddiik/server@0.2.1
  - @abubakarsiddiik/runtime@0.1.2
  - @abubakarsiddiik/sources@0.2.1
  - @abubakarsiddiik/skills@0.1.2

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
