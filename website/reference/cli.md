# CLI

```text
portolan <command> [options]
```

## Commands

| Command | What it does |
|---|---|
| `portolan init [dir]` | Initialize `<dir>/.portolan/` (config, policy, maps, skills, and the `portolan-map` / `portolan` skills). |
| `portolan migrate [dir]` | Move a legacy root layout (`portolan.config.json`, `qa/`, `maps/`, …) into `.portolan/`. |
| `portolan auth login` | Open a visible browser, sign in, and save a Playwright storage state; with `--fill`/`--script`, sign in unattended and save a recipe. |
| `portolan auth refresh` | Replay a saved recipe and replace the session. |
| `portolan map build` | Discover a URL and/or traces into a draft, verify, and publish. |
| `portolan map update` | Refresh an existing map and keep capabilities discovery did not see. |
| `portolan map sync --since <ref>` | Re-check only the pages the changes since a git ref affect: scoped update, re-verify, repair a drifted locator, then diff coverage. `--dry-run`, `--fail-on`, `--markdown`. |
| `portolan map status` | Where the mapping loop stands: version, coverage, uncompiled traces, last build failures, auth expiry, next command. `--json` for data. |
| `portolan map record --gaps` | Record a one-click run for each missing capability, tagged with its capability id. Flags: `--kind`, `--only`, `--max`, `--writes`. |
| `portolan map coverage` | Report `mapped`, `missing`, `excluded`, `unavailable`, `stale`, and `removed` capabilities. `--older-than 7d` lists entries no crawl has seen recently. |
| `portolan map capability` | Add a capability manually or set its status/reason (`add` / `set`). |
| `portolan mcp` | Serve MCP over stdio for a client to spawn. `--watch` opens a Chrome window you can watch, plus a live timeline of every tool call. |
| `portolan serve` | Start the HTTP and MCP server. |
| `portolan compile <trace...>` | Compile traces into candidates, verify them, and publish the ones that pass as a new map version. Flags: `--map`, `--base-url`, `--outcome-checks`, `--params`, `--verify-writes`. |
| `portolan verify` | Verify a map's operations on a fresh session. |
| `portolan export-skills` | Export a `portolan-<site>` skill from a map. |
| `portolan qa <command>` | Agent-first QA: generate, run, repair, and verify test cases. |
| `portolan bench [suite]` | Run a benchmark suite from the source checkout. |
| `portolan doctor` | Diagnose the browser, config, providers, and clients. |

## Common options

| Option | Meaning |
|---|---|
| `--config <path>` | Config file. Default `./.portolan/config.json` (legacy `./portolan.config.json` still loads with a notice). |
| `--version`, `-v` | Print the CLI version. |
| `--help` | Show usage. |

Command flags beat the config file, which beats the default.

## Map commands

| Command | What it does |
|---|---|
| `portolan map build` | Open the URL, discover pages/links/forms/buttons, write `draft.json`, `tasks.json`, and `capabilities.json`, verify, and publish. |
| `portolan map update` | Same discovery, reconciled against the existing map. |
| `portolan map coverage` | Print the capability ledger and gaps. `--json` gives the machine-readable form. |
| `portolan map capability add` | Add a code-derived or manual capability. |
| `portolan map capability set` | Mark a capability `missing` or `excluded` with a reason. Manual decisions survive rediscovery. |

Map flags: `--site`, `--maps`, `--url`, `--base-url`, `--traces-dir`, `--params`,
`--max-pages`, `--storage-state`, `--start "<cmd>"`, `--verify`,
`--verify-writes`, `--outcome-checks`, `--publish`, `--require-complete`, `--exclude <pattern>`,
`--allow-cost`, `--strict`, `--state <id>` (with `map update`), `--headed`, `--chrome`.

`--require-complete` refuses to publish while any capability is `missing` or
`stale`. Excluded capabilities need a reason.

`portolan auth login` flags: `--url <sign-in page>`, `--out <file>`,
`--timeout-ms`, `--chrome`.

## QA commands

| Command | What it does |
|---|---|
| `portolan qa init` | Write `.portolan/` config, dirs, and skill; print the MCP snippet, and write or merge `.mcp.json` only with `--mcp`. |
| `portolan qa list` | List cases and their status. |
| `portolan qa plan` | Choose cases affected by the git diff. |
| `portolan qa run` | Run cases (deterministic; no model). |
| `portolan qa result <run_id>` | Read a run's typed results. |
| `portolan qa case read <id>` | Read one case spec. |
| `portolan qa case write <file>` | Validate and write one case (always draft). |
| `portolan qa generate` | Turn a spec or a recorded trace into a draft case. |
| `portolan qa repair <case_id>` | Recover a broken locator from a failed run. |
| `portolan qa verify` | Replay cases and promote verified ones. |
| `portolan qa coverage` | List routes covered by cases. |
| `portolan qa report <run_id>` | Render a run as json, md, or junit. |
| `portolan qa sync` | Reconcile case files with the local database. |
| `portolan qa doctor` | Check config, database, and the browser. |
| `portolan qa mcp` | Serve the QA MCP server over stdio. |

Selection flags: `--changed`, `--suite NAME`, `--case ID` (repeatable),
`--tag TAG`, `--all`. Common flags: `--json`, `--config PATH`, `--repeat N`,
`--allow-unverified`, `--base-url URL`.

## Examples

```bash
# initialize a project
portolan init ./my-site --site store

# serve MCP over stdio (what a client spawns)
portolan mcp

# the same, and watch the agent work: a visible Chrome window that stays open,
# starting on a live timeline at http://127.0.0.1:4300
portolan mcp --watch

# serve MCP over streamable HTTP
portolan serve --port 4200

# verify a map against a live site
portolan verify --map maps/store/v1.json --params store.params.json \
  --base-url https://store.example

# export a skill from a map
portolan export-skills --map .portolan/maps/store/v1.json

# build a map for an app, including authenticated pages
portolan auth login --url https://app.example/sign-in --out ./.portolan/state/auth.json
portolan map build --maps ./.portolan/maps --site myapp \
  --url https://app.example/dashboard --storage-state ./.portolan/state/auth.json \
  --verify --publish

# close the coverage gaps, then gate publication
portolan map coverage --site myapp --maps ./.portolan/maps --json
portolan map build --maps ./.portolan/maps --site myapp \
  --url https://app.example/dashboard --require-complete --verify --publish
```

## Environment

The CLI reads `.portolan/config.json` and these variables:

| Variable | Meaning |
|---|---|
| `PORTOLAN_CONFIG` | Config file when `--config` is absent. |
| `MAPS_DIR` | Map directory for `portolan mcp`. Default `.portolan/maps`. |
| `DATABASE_PATH` | Session and audit database for `portolan mcp`. Default `.portolan/state/portolan.db`. |
| `TRACES_DIR` | Recorded fallback and explore traces for `mcp`, `serve`, and `map`. Default `.portolan/state/traces`. |
| `PORTOLAN_STORAGE_STATE` | Playwright storage state for authenticated pages. |
| `CHROME_PATH` | Chrome binary when `chrome` is unset. |
| `PORTOLAN_AUTH_TOKEN` | Bearer token for a non-loopback `serve` bind. |
| `PORTOLAN_WATCH` | `1` turns on `portolan mcp --watch`; a number sets the timeline port. Easier than an argument in an MCP client config. |

See [Configuration](/reference/configuration) for every option.

## Watching an agent

`portolan mcp --watch` lets a person see what the agent does without changing
it. Chrome opens as a normal window on a timeline at `http://127.0.0.1:4300`
that lists every tool call: its arguments, its result or typed error, and how
long it took. Each session the agent opens gets its own window in that Chrome,
and the timeline mirrors it live. The window stays open until the server
exits, and you can click in it, though a page you change under the agent can
make its next `act` miss.

- `--watch-port <n>` picks the port; the next free one is used if it is taken.
- `--headless` keeps Chrome hidden; the timeline still mirrors the page.
- Values typed into password fields and credential-shaped text are redacted
  before they reach the timeline. It binds to loopback only.
- `http` ops run from a saved session have no page, so they appear only in
  the timeline.

In an MCP client config, add `"PORTOLAN_WATCH": "1"` to the server's `env`
or `"--watch"` to its `args`.
