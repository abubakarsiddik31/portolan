# CLI

```text
portolan <command> [options]
```

## Commands

| Command | What it does |
|---|---|
| `portolan init [dir]` | Write a config, a policy, the `maps/` and `skills/` directories, and the `portolan-map` / `portolan` skills. |
| `portolan auth login` | Open a visible browser, sign in, and save a Playwright storage state. |
| `portolan map build` | Discover a URL and/or traces into a draft, verify, and publish. |
| `portolan map update` | Refresh an existing map and keep capabilities discovery did not see. |
| `portolan map coverage` | Report `mapped`, `missing`, `excluded`, and `stale` capabilities. |
| `portolan map capability` | Add a capability manually or set its status/reason (`add` / `set`). |
| `portolan mcp` | Serve MCP over stdio for a client to spawn. |
| `portolan serve` | Start the HTTP and MCP server. |
| `portolan compile <trace...>` | Compile traces into a new map version. |
| `portolan verify` | Verify a map's operations on a fresh session. |
| `portolan export-skills` | Export a `portolan-<site>` skill from a map. |
| `portolan qa <command>` | Agent-first QA: generate, run, repair, and verify test cases. |
| `portolan bench [suite]` | Run a benchmark suite from the source checkout. |
| `portolan doctor` | Diagnose the browser, config, providers, and clients. |

## Common options

| Option | Meaning |
|---|---|
| `--config <path>` | Config file. Default `./portolan.config.json`. |
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
`--verify-writes`, `--publish`, `--require-complete`, `--exclude <pattern>`,
`--headed`, `--chrome`.

`--require-complete` refuses to publish while any capability is `missing` or
`stale`. Excluded capabilities need a reason.

`portolan auth login` flags: `--url <sign-in page>`, `--out <file>`,
`--timeout-ms`, `--chrome`.

## QA commands

| Command | What it does |
|---|---|
| `portolan qa init` | Write config, dirs, skill, and the MCP entry (Claude) or a snippet. |
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

# serve MCP over streamable HTTP
portolan serve --port 4200

# verify a map against a live site
portolan verify --map maps/store/v1.json --params store.params.json \
  --base-url https://store.example

# export a skill from a map
portolan export-skills --map maps/store/v1.json --out skills

# build a map for an app, including authenticated pages
portolan auth login --url https://app.example/sign-in --out ./portolan/auth.json
portolan map build --maps ./portolan/maps --site myapp \
  --url https://app.example/dashboard --storage-state ./portolan/auth.json \
  --verify --publish

# close the coverage gaps, then gate publication
portolan map coverage --site myapp --maps ./portolan/maps --json
portolan map build --maps ./portolan/maps --site myapp \
  --url https://app.example/dashboard --require-complete --verify --publish
```

## Environment

The CLI reads `portolan.config.json` and these variables:

| Variable | Meaning |
|---|---|
| `PORTOLAN_CONFIG` | Config file when `--config` is absent. |
| `MAPS_DIR` | Map directory for `portolan mcp`. Default `maps`. |
| `DATABASE_PATH` | Session and audit database for `portolan mcp`. |
| `TRACES_DIR` | Recorded fallback and explore traces for `mcp`, `serve`, and `map`. |
| `PORTOLAN_STORAGE_STATE` | Playwright storage state for authenticated pages. |
| `CHROME_PATH` | Chrome binary when `chrome` is unset. |
| `PORTOLAN_AUTH_TOKEN` | Bearer token for a non-loopback `serve` bind. |

See [Configuration](/reference/configuration) for every option.
