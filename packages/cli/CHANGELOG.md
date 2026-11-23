# @abubakarsiddiik/portolan

## 0.4.0

### Minor Changes

- 71f3e62: This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.
  
  A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.

### Patch Changes

- 11edef4: `portolan <command> --help` lists that command's flags. `init --url` seeds the site policy's `allow` list, and `map build` falls back to its `--url` host when the policy's `allow` is empty, so the first build is no longer blocked by `egress blocked ... (not_allowed)`. `map build` now shares one verification Chrome across all ops, as 0.3.2 intended.
- 8be02ae: `map build` closes the discovery browser before verification starts, so a build keeps one Chrome open, not two.
- d0b420d: `portolan compile` now verifies each candidate before it publishes, as the docs always said. Reads use the recorded values plus variants; a write runs only with `--verify-writes` and a `--params` file of at least three sets. A step the map does not cover is named from its recorded actions instead of failing with "no candidate ops", and a new write compiles to a `ui` op unless `--outcome-checks` names the read that proves it. `map build` takes `--outcome-checks` too.
- 1944c88: `map build` says when the crawl stopped at `--max-pages` or the op limit with pages still queued, and records it in `draft.json`. When nothing verifies, the error lists each op's failure reason.
- 96ed037: A layout control that sits in a landmark on three or more pages (account menu, "Back to workspace") is one capability with `pages`, and its op is valid from all of them. Data in a control's name is templated (`Active {count}`, `Delete {email}`), so filter tabs and row actions are one entry each. `--no-dedupe` keeps the per-page entries. `--strict`, `--allow-cost` and `--no-dedupe` no longer swallow the next argument.
- 7b21b90: Verification is faster. Identical param sets run once and an op with no required params needs one run. `map build --verify` runs reads side by side (`--concurrency`, default 4) while writes stay serial, and skips ops already verified against the same app build (`--app-version`, or a hash of the served HTML; `--reverify` to force). A `map update` that finds nothing new now says so instead of failing with "nothing verified".
- c922276: Count only verified ops as mapped in `capabilities.json`. A proposal that fails verification now leaves its trigger `missing` with the failure as the reason, and `--require-complete` checks that result.
- 1692e2e: `map build` proposes postconditions from what a recorded run showed (a changed path or query, a new state, a dialog that appeared), so "verified" means the effect happened, not only that the click did not throw. The `url` check gains an optional `search`, an op can set `no_post`, a `ui` op with no postcondition gets an `add_postcondition` task, and `--require-post` refuses to verify it.
- fc8094f: `map build` keeps what it learned:
  - `--traces-dir` is read alongside `--url`.
  - A traces-only build, or a crawl that never reached a page, no longer marks that page's capabilities `stale`. A trace op that covers a missing capability now marks it mapped.
  - When nothing verifies, `draft.json` and `tasks.json` are written first so the `did not verify` reasons survive.
- 2976560: `portolan map status` shows where the mapping loop stands (version, coverage, recorded runs not yet compiled, the last build's failures grouped by reason, auth expiry, and the next command), and every build is journaled to `.portolan/state/builds.jsonl`. `portolan mcp` adds `map_status`, `map_gaps`, `capability_set`, `map_record_gaps`, `map_build` and `map_job`, so an MCP-only client can finish a map; the two that run a browser need `confirm: true`.
- d90680a: `portolan map sync --since <git-ref>` keeps a map in step with the code: it maps the changed files to the pages they affect (config globs, plus a route table read from source), updates and verifies only those states, repairs an op whose control was renamed to a clearly closest match, and marks one it cannot repair stale. `portolan map coverage --diff <v3|git-ref>` lists new missing, stale and mapped capabilities, exits 1 on `--fail-on` regressions, and writes a pull request comment with `--markdown`. The guide has a GitHub Actions recipe.
- 9862d0a: Verification no longer launches a Chrome per run. `verifyOp` opens one browser and an isolated context per run, and `map build` shares a single browser across every op it verifies, so a build stops spawning dozens of Chrome processes.
- d3ae878: Boolean flags no longer swallow the next positional, so `--verify --publish trace.json` keeps the trace.
- 05435df: Exclusion rules move into `policies/<site>.json` as categorized `rules`, matched on a control's label and/or the request its recorded run fired. Excluded capabilities carry a generated `category: reason`, a notifications bell and a trailing `?` are no longer excluded, and an op whose run fired a `cost` or `destructive` request is held back from verification unless `--allow-cost` is passed. `portolan policy allow --site x host` edits the allow list, and a build that was blocked prints the hosts to allow.
- bc409a2: Discovery reaches routes that links do not. `--url` can be repeated to crawl several entry points in one build, `--routes <file>` and `--routes-from react-router|next|sveltekit` read the route table (static routes are crawled, and the ones nothing reached are listed), and `--explore` clicks buttons that policy allows to find routes only a button leads to, recording each as a navigation op.
- 282b1c5: `portolan map record --gaps` records a one-click run for every missing button without an agent loop, writing traces tagged with the capability id. A build then covers exactly that capability, so matching no longer depends on a label two pages may share. `open_url` and `fallback_begin` accept an optional `capability` for the same link.
- b37ec2f: Staleness is scoped to what a run observed. Capabilities carry `last_seen` and `last_verified`; a control gone from a page the crawl reached is `removed`, and `stale` is kept for an op that used to verify and now fails. `map update --state <id>` re-crawls and re-verifies only that state, `map coverage --older-than 7d` lists what nothing has seen lately, and `discoverDom` accepts several entry points.
- b829173: `map build --verify` now opens a parameterized start state (such as `/orgs/:id`) with the read op that leads there, so a ui op recorded on that page can verify.
- fe40c0f: `portolan auth login` can sign in without a person: `--fill "textbox:Label=ENV_VAR"` and `--submit` (or `--script file.mjs`) replay a headless sign-in from environment variables, and `auth refresh` replays the recipe saved beside the session. A build with that `--storage-state` replaces a session that is about to expire and signs in again once when an op fails because the session lapsed. `auth status` shows the token's expiry.
- 3eebde3: A control that is disabled everywhere the crawl saw it is recorded as `unavailable` with a precondition, not `missing`. `map coverage` lists these separately, and `--require-complete` ignores them unless `--strict` is passed.
- Updated dependencies [d0b420d]
- Updated dependencies [1944c88]
- Updated dependencies [96ed037]
- Updated dependencies [7b21b90]
- Updated dependencies [c922276]
- Updated dependencies [1692e2e]
- Updated dependencies [fc8094f]
- Updated dependencies [2976560]
- Updated dependencies [d90680a]
- Updated dependencies [9862d0a]
- Updated dependencies [05435df]
- Updated dependencies [71f3e62]
- Updated dependencies [a219edd]
- Updated dependencies [9c2c103]
- Updated dependencies [effd6d1]
- Updated dependencies [3f78adf]
- Updated dependencies [bc409a2]
- Updated dependencies [282b1c5]
- Updated dependencies [b37ec2f]
- Updated dependencies [3e3e5f2]
- Updated dependencies [fe40c0f]
- Updated dependencies [3eebde3]
- Updated dependencies [0eed231]
  - @abubakarsiddiik/compiler@0.2.6
  - @abubakarsiddiik/sources@0.2.6
  - @abubakarsiddiik/protocol@0.2.2
  - @abubakarsiddiik/runtime@0.1.7
  - @abubakarsiddiik/server@0.2.6
  - @abubakarsiddiik/substrate@0.2.2
  - @abubakarsiddiik/qa@0.3.0
  - @abubakarsiddiik/skills@0.1.7

## 0.3.1

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
  - @abubakarsiddiik/server@0.2.5
  - @abubakarsiddiik/substrate@0.2.1
  - @abubakarsiddiik/qa@0.2.1
  - @abubakarsiddiik/compiler@0.2.5
  - @abubakarsiddiik/runtime@0.1.6
  - @abubakarsiddiik/sources@0.2.5
  - @abubakarsiddiik/skills@0.1.6

## 0.3.0

### Minor Changes

- b724e84: Run QA against named environments (dev, qa, prod) with a saved session per
  account, so the agent picks a name and never handles a credential.
  
  - `environments` in `.portolan/config.json`: `baseUrl`, `profiles`, optional
    `loginUrl`, and `writes` (default `false`). Parsed strictly; a typo fails
    instead of leaving prod writable.
  - `portolan auth login --env NAME --profile P` signs in once in a real browser
    and waits for you to confirm, then saves the session outside the repo under
    `~/.portolan/sessions` (`PORTOLAN_HOME`), `0600` in a `0700` directory, written
    atomically. `portolan auth status` lists which profiles have one.
  - `qa_run`, `qa_verify`, `qa_repair`, and `portolan qa run|verify|repair` take
    `env` and `as`. New `qa_environments` tool lists environments and session
    presence, never a path or a credential. A missing session is `auth_missing`
    with the sign-in command in `details.next`.
  - A read-only environment skips non-read cases and the browser aborts
    non-GET/HEAD/OPTIONS requests (`PlaywrightEngine` `readOnly`). A `goto` off
    the environment origin fails, and `${env.QA_*}` values resolve only on it.
  - Fix: a resolved `${env.*}` secret could leak through a failed fill's
    `expected`, a `value` check's `actual`, or evidence. Every resolved value is
    now scrubbed from results, events, evidence, and the database in raw,
    URL-encoded, JSON-escaped, and base64 form.
  - Breaking: `${env.*}` in a case now resolves only `QA_*` variables, and only
    in a step's `value` or `params`, never in `goto`, `contains`, or `pattern`.
  - `auth login` writes the session `0600` from creation instead of `chmod`ing
    afterwards.

### Patch Changes

- Updated dependencies [b724e84]
  - @abubakarsiddiik/qa@0.2.0
  - @abubakarsiddiik/substrate@0.2.0
  - @abubakarsiddiik/compiler@0.2.4
  - @abubakarsiddiik/server@0.2.4
  - @abubakarsiddiik/runtime@0.1.5
  - @abubakarsiddiik/sources@0.2.4
  - @abubakarsiddiik/skills@0.1.5

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
