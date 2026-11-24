# @abubakarsiddiik/sources

## 0.3.0

### Minor Changes

- 49b8cc6: `map build` records the backend's endpoints. While it crawls, the API calls each page makes are grouped into endpoints (method and path with ids as `{id}`, query parameters, body and response keys, statuses, the pages that call them, whether they were authenticated) and written to `endpoints.json`. `map status` shows how many an op's `http` impl reaches and how many writes no op reaches, so a part of the backend no button exposed is a visible gap.
- ed7603d: Ops keep their context. A recorded or discovered op used to be "click Save" with no sign of which page, which panel or which record, so an agent could not tell two `delete` buttons apart or know what a call would change. An op now has an optional `context` (the goal it was recorded for, the page, the named panel, the row it acts on, and what happened when it ran: the API calls and the messages shown). Discovery reads it from the page's structure, and the same label in two panels is now two capabilities instead of one. The compiler keeps the run's story, and a summary that would say only "Recorded: click Save." becomes the goal. `open_site` and the tool descriptions show it, and `map lint` warns about a bare parameterless `ui` op. Also fixes an `http` op compiled from a recording dropping its `auth`.

### Patch Changes

- 1944c88: `map build` says when the crawl stopped at `--max-pages` or the op limit with pages still queued, and records it in `draft.json`. When nothing verifies, the error lists each op's failure reason.
- 96ed037: A layout control that sits in a landmark on three or more pages (account menu, "Back to workspace") is one capability with `pages`, and its op is valid from all of them. Data in a control's name is templated (`Active {count}`, `Delete {email}`), so filter tabs and row actions are one entry each. `--no-dedupe` keeps the per-page entries. `--strict`, `--allow-cost` and `--no-dedupe` no longer swallow the next argument.
- c922276: Count only verified ops as mapped in `capabilities.json`. A proposal that fails verification now leaves its trigger `missing` with the failure as the reason, and `--require-complete` checks that result.
- 1692e2e: `map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
- fc8094f: `map build` keeps what it learned:
  - `--traces-dir` is read alongside `--url`.
  - A traces-only build, or a crawl that never reached a page, no longer marks that page's capabilities `stale`. A trace op that covers a missing capability now marks it mapped.
  - When nothing verifies, `draft.json` and `tasks.json` are written first so the `did not verify` reasons survive.
- d90680a: `portolan map sync --since <git-ref>` keeps a map in step with the code: it maps the changed files to the pages they affect (config globs, plus a route table read from source), updates and verifies only those states, repairs an op whose control was renamed to a clearly closest match, and marks one it cannot repair stale. `portolan map coverage --diff <v3|git-ref>` lists new missing, stale and mapped capabilities, exits 1 on `--fail-on` regressions, and writes a pull request comment with `--markdown`. The guide has a GitHub Actions recipe.
- 05435df: Exclusion rules move into `policies/<site>.json` as categorized `rules`, matched on a control's label and/or the request its recorded run fired. Excluded capabilities carry a generated `category: reason`, a notifications bell and a trailing `?` are no longer excluded, and an op whose run fired a `cost` or `destructive` request is held back from verification unless `--allow-cost` is passed. `portolan policy allow --site x host` edits the allow list, and a build that was blocked prints the hosts to allow.
- 71f3e62: This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.
  
  A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.
- bc409a2: Discovery reaches routes that links do not. `--url` can be repeated to crawl several entry points in one build, `--routes <file>` and `--routes-from react-router|next|sveltekit` read the route table (static routes are crawled, and the ones nothing reached are listed), and `--explore` clicks buttons that policy allows to find routes only a button leads to, recording each as a navigation op.
- 282b1c5: `portolan map record --gaps` records a one-click run for every missing button without an agent loop, writing traces tagged with the capability id. A build then covers exactly that capability, so matching no longer depends on a label two pages may share. `open_url` and `fallback_begin` accept an optional `capability` for the same link.
- b37ec2f: Staleness is scoped to what a run observed. Capabilities carry `last_seen` and `last_verified`; a control gone from a page the crawl reached is `removed`, and `stale` is kept for an op that used to verify and now fails. `map update --state <id>` re-crawls and re-verifies only that state, `map coverage --older-than 7d` lists what nothing has seen lately, and `discoverDom` accepts several entry points.
- 3e3e5f2: A recorded `ui` step whose control name carries data (`Active 1`, `Delete a@x.com`) is located by a `name_re` pattern instead of the recorded text, so the op keeps working when the count or the row changes.
- 3eebde3: A control that is disabled everywhere the crawl saw it is recorded as `unavailable` with a precondition, not `missing`. `map coverage` lists these separately, and `--require-complete` ignores them unless `--strict` is passed.
- Updated dependencies [49b8cc6]
- Updated dependencies [730069f]
- Updated dependencies [1692e2e]
- Updated dependencies [9862d0a]
- Updated dependencies [ed7603d]
- Updated dependencies [05435df]
- Updated dependencies [71f3e62]
- Updated dependencies [3e3e5f2]
- Updated dependencies [fe40c0f]
  - @abubakarsiddiik/substrate@0.3.0
  - @abubakarsiddiik/protocol@0.3.0

## 0.2.5

### Patch Changes

- Updated dependencies [af07fa8]
  - @abubakarsiddiik/substrate@0.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [b724e84]
  - @abubakarsiddiik/substrate@0.2.0

## 0.2.3

### Patch Changes

- Updated dependencies [87d27fd]
  - @abubakarsiddiik/substrate@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [af649af]
  - @abubakarsiddiik/protocol@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [ee738c0]
  - @abubakarsiddiik/substrate@0.1.1

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
