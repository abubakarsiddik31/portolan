# @abubakarsiddiik/qa

## 0.3.0

### Minor Changes

- 71f3e62: This release adds `map sync`, `map status`, `map record --gaps`, `policy allow`, `auth refresh` and unattended sign-in, and in QA `expect_failure` and waiting checks, so the CLI and QA move to a new minor version.
  
  A path segment like `p_101`, `ord_1` or `usr_9f3a` is now an id, so `/p/p_101` and `/p/p_102` are one state and one parameterized op. Every flag the CLI reads as a boolean (`--dry-run`, `--all`, `--allow-unverified`, `--changed`, `--mcp`, `--include-quarantined` were missing) no longer swallows the next argument.
- 3b0151c: A write op in a QA case now runs through the same guard as an MCP write. An irreversible op needs `confirm`, each write has an idempotency key in the write ledger (a step can set `idempotency_key`), and the op's `outcome_check` settles a write whose result is in doubt. `QaService` takes an optional `ledger` so QA writes and MCP writes share one.

### Patch Changes

- a219edd: A write case's `map.op` is now checked: the map version must exist, the op must be in it with the case's `effect`, and an irreversible op's step needs `confirm: true`. It is enforced at `qa case write`, reported by `qa sync`, and a case with a wrong link is not run (it returns an `invalid_request` error). `map: { site, pending: "<why>" }` marks a write that has no op yet, and `qa sync` lists those.
- 9c2c103: Redaction no longer rewrites case ids. `auth/wrong-password-shows-error` stays that in run results, evidence and the commands the result suggests, so results still match their case files; secrets and secret-looking keys are redacted as before.
- effd6d1: A case for a known bug can be marked `expect_failure: { reason, issue? }`. `qa verify` promotes it when it fails with the same code and step on every replay, and `qa run` reports it as `known_failure` (the run stays green) instead of skipping it as unverified. When it starts passing the run reports `fixed` and says to remove the marker. A different failure is still a `fail`.
- 3f78adf: QA checks retry until the run's timeout instead of judging the first view, so an async page passes without a manual `await` and `absent` cannot pass before the page renders. `await` also takes `visible`, `absent` and `value`. The `url` check and `await url` can assert a query or fragment (`"/analytics\?range=30d"`, or `{ pathname, query, hash }`). A failure's evidence folder gains `text.txt` with the full page text, `page.png` when screenshots are on, and `read_scope` in `result.json` when a dialog scoped the read.
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

## 0.2.1

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

## 0.2.0

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
  - @abubakarsiddiik/substrate@0.2.0
  - @abubakarsiddiik/runtime@0.1.5

## 0.1.5

### Patch Changes

- Updated dependencies [87d27fd]
  - @abubakarsiddiik/substrate@0.1.2
  - @abubakarsiddiik/runtime@0.1.4

## 0.1.4

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

## 0.1.3

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
  - @abubakarsiddiik/runtime@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [099fe69]
  - @abubakarsiddiik/protocol@0.2.0
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

## 0.1.0

### Minor Changes

- 0f9570f: Add local, agent-first QA: a deterministic test runner with a local SQLite
  store, database-derived verification, MCP tools and CLI commands, and case
  files that compose UI steps and map ops. The substrate gains an optional
  viewport screenshot for evidence.

### Patch Changes

- Updated dependencies [05f2358]
- Updated dependencies [0f9570f]
  - @abubakarsiddiik/protocol@0.1.0
  - @abubakarsiddiik/substrate@0.1.0
  - @abubakarsiddiik/runtime@0.1.0
