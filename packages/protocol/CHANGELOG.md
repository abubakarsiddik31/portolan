# @abubakarsiddiik/protocol

## 0.3.0

### Minor Changes

- 730069f: An `http` op can now authenticate the way the site's own frontend does. The impl takes an optional `auth` that points at where the page keeps its token (`localStorage`, `sessionStorage` or a cookie, with an optional JSON path), so a write to an API on another origin sends `Authorization: Bearer ...` instead of failing with 401. The map stores the location, never the token, and the op fails with `auth_missing` when the token is gone. `map build` records the location from the requests it captures.
- ed7603d: Ops keep their context. A recorded or discovered op used to be "click Save" with no sign of which page, which panel or which record, so an agent could not tell two `delete` buttons apart or know what a call would change. An op now has an optional `context` (the goal it was recorded for, the page, the named panel, the row it acts on, and what happened when it ran: the API calls and the messages shown). Discovery reads it from the page's structure, and the same label in two panels is now two capabilities instead of one. The compiler keeps the run's story, and a summary that would say only "Recorded: click Save." becomes the goal. `open_site` and the tool descriptions show it, and `map lint` warns about a bare parameterless `ui` op. Also fixes an `http` op compiled from a recording dropping its `auth`.

### Patch Changes

- 1692e2e: `map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
- 71f3e62: This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.
  
  A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.
- 3e3e5f2: A recorded `ui` step whose control name carries data (`Active 1`, `Delete a@x.com`) is located by a `name_re` pattern instead of the recorded text, so the op keeps working when the count or the row changes.

## 0.2.1

### Patch Changes

- af649af: Keep every project file Portolan creates under `.portolan/`, with committed
  artifacts and an ignored `state/` directory in one place. Add
  `.portolan/config.json` discovery with a legacy `portolan.config.json`
  fallback, `portolan migrate`, and `.mcp.json` opt-in wiring for QA.
  
  Also fix `portolan --version`, `qa --help`, failed `absent` check details,
  `qa doctor` hints, and the missing-suite message.

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

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.
