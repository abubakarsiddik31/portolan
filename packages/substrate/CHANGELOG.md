# @abubakarsiddiik/substrate

## 0.2.2

### Patch Changes

- 9862d0a: Verification no longer launches a Chrome per run. `verifyOp` opens one browser and an isolated context per run, and `map build` shares a single browser across every op it verifies, so a build stops spawning dozens of Chrome processes.
- 05435df: Exclusion rules move into `policies/<site>.json` as categorized `rules`, matched on a control's label and/or the request its recorded run fired. Excluded capabilities carry a generated `category: reason`, a notifications bell and a trailing `?` are no longer excluded, and an op whose run fired a `cost` or `destructive` request is held back from verification unless `--allow-cost` is passed. `portolan policy allow --site x host` edits the allow list, and a build that was blocked prints the hosts to allow.
- fe40c0f: `portolan auth login` can sign in without a person: `--fill "textbox:Label=ENV_VAR"` and `--submit` (or `--script file.mjs`) replay a headless sign-in from environment variables, and `auth refresh` replays the recipe saved beside the session. A build with that `--storage-state` replaces a session that is about to expire and signs in again once when an op fails because the session lapsed. `auth status` shows the token's expiry.

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

## 0.1.2

### Patch Changes

- 87d27fd: Settle client-rendered pages before verifying or resolving `ui` ops, so a
  locator is not read from the empty shell at `domcontentloaded`.
  
  - The verifier navigates a fresh session with `substrate.goto`, which waits for
    quiescence, instead of the engine's early `navigate`.
  - `runUiOp` settles and retries the initial state, step locators, awaited
    states, postconditions, and extraction when the first capture misses, so a
    `call` on a just-navigated page no longer races hydration.

## 0.1.1

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

## 0.1.0

### Minor Changes

- 05f2358: Initial public alpha: the map protocol, model port, browser substrate,
  compiler, op runtime, HTTP/MCP server, skill exporter, and the `portolan`
  command.
- 0f9570f: Add local, agent-first QA: a deterministic test runner with a local SQLite
  store, database-derived verification, MCP tools and CLI commands, and case
  files that compose UI steps and map ops. The substrate gains an optional
  viewport screenshot for evidence.
