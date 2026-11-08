# @portolan/cli

The `portolan` command.

## Run

```bash
pnpm --filter @portolan/cli build
node packages/cli/dist/bin.js --help
```

## Commands

### `portolan init [dir]`

Writes a starting `portolan.config.json`, `policies/<site>.json` with an empty
allowlist, and the `maps/<site>/` and `skills/` directories. Existing files are
kept unless `--force` is passed.

Options: `--site <name>`, `--force`.

### `portolan serve`

Starts the HTTP and MCP server from the config.

Options: `--config <path>`, `--host`, `--port`, `--database`, `--maps`.
`SIGINT` and `SIGTERM` close the server and the database.

### `portolan compile <trace...>`

Compiles trace JSON files into candidate ops and publishes a new map version.
The map supplies op names, schemas, and effects; the traces supply the
evidence. A url op's post-state is captured from a live browser when
`--base-url` is given.

Options: `--map <path>` (required), `--base-url <url>`,
`--outcome-checks <json>` (op name to the read op that proves the write),
`--trace <path>` (repeatable, instead of positionals), `--chrome <path>`,
`--headed`.

### `portolan verify`

Verifies a map's ops on a fresh session. Each op needs at least three param
sets; an op without one is reported unverified, and the command exits `1`.

Options: `--map <path>`, `--params <path>` (required), `--op <name>`
(repeatable), `--base-url <url>`, `--chrome <path>`, `--headed`.

The params file is a JSON object:

```json
{ "search": [{ "query": "tee" }, { "query": "mug" }, { "query": "cap" }] }
```

### `portolan export-skills`

Exports a `portolan-<site>` skill from a map. Recipes are mined from any
`--trace` files; `--gotcha` adds a line under Gotchas.

Options: `--map <path>` (required), `--out <dir>` (default `skills`),
`--trace <path>` (repeatable), `--gotcha <text>` (repeatable).

### `portolan bench [suite]`

Runs a benchmark suite from the source checkout. `--list` prints the suites
(`pilot`, `n3`, `drift`, `conformance`, `oracle`, `local`). The benchmark
harness is not part of the published package.

### `portolan doctor [--json]`

Diagnoses the local install:

| Check | What it looks for | Status when missing |
|---|---|---|
| `node` | Node 22.12 or newer | fail |
| `browser` | `CHROME_PATH`, then Chrome/Chromium; runs `--version` | fail |
| `config` | `PORTOLAN_CONFIG`, else `./portolan.config.json`; must parse as a JSON object | fail if invalid, warn if absent |
| `providers` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST` | warn |
| `clients` | Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI, Codex; does any name `portolan`? | warn |

Provider values are never printed, only the provider names.

## Exit codes

`0` success (warnings allowed), `1` a command failed, `2` an unknown command.

## Config

`portolan.config.json`, merged over defaults. Every option is documented with
its default in [docs/CONFIG.md](../../docs/CONFIG.md).

The short version:

```json
{
  "site": "site",
  "maps": "maps",
  "skills": "skills",
  "policies": "policies",
  "database": "portolan.db",
  "host": "127.0.0.1",
  "port": 4200,
  "headless": true,
  "sessionTtlMs": 1800000,
  "maxOpenSessions": 100,
  "cleanupIntervalMs": 60000,
  "recoverSessions": true,
  "logLevel": "info"
}
```

`baseUrl` and `chrome` are optional. An unknown key is ignored so a newer
config does not break an older CLI.
