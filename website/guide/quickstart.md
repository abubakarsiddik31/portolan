# Quickstart

From a clone to a working MCP call in about ten minutes.

::: tip Install from npm
The CLI is published as `@abubakarsiddiik/portolan`. This guide uses a source
checkout so you can run the demo fixtures, but you can install the CLI directly:

```bash
npm install -g @abubakarsiddiik/portolan
```
:::

## 1. Prerequisites

- Node 22.12 or newer.
- Google Chrome or Chromium. Set `CHROME_PATH` if it is not in a usual place.

```bash
node --version
```

## 2. Build

```bash
git clone https://github.com/abubakarsiddik31/portolan.git
cd portolan
pnpm install
pnpm build
```

## 3. Start the demo site and the server

The repository ships a store fixture. In one terminal:

```bash
pnpm --filter @abubakarsiddiik/bench fixtures:store
```

That serves the store on `http://127.0.0.1:4100`. In a second terminal, from the
repository root:

```bash
DATABASE_PATH=:memory: MAPS_DIR=maps node packages/cli/dist/bin.js mcp
```

This is the MCP server on stdio. It reads maps from `maps/` and keeps sessions
in memory.

## 4. Connect a client

Point a client at the command. For Claude Code:

```bash
claude mcp add portolan -- env MAPS_DIR="$PWD/maps" DATABASE_PATH=:memory: \
  node "$PWD/packages/cli/dist/bin.js" mcp
```

Or use the JSON/TOML snippets in [Client setup](/guide/clients) for Claude
Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code.

## 5. Make a call

Ask the client to call `open_site` with `{ "site": "store" }`. It returns the
compact map:

```text
store · map v1
  search(query, page)        Search the catalog.   [read]
  get_product(product_id)    ...
  add_to_cart(...)                               [write]
  checkout(...)                                  [irreversible]
```

Then call `view` to read the page. You should see the catalog, the search box,
and a ranked list of affordances.

That is the loop: `open_site` tells the agent what the site can do, `call` runs
a named operation, and `view` / `act` / `read` are the fallback when no
operation fits.

## 6. Check the install

```bash
node packages/cli/dist/bin.js doctor
```

`doctor` reports the browser, config, provider variables, and client configs.

## Build a map for your app

The demo above uses a fixture map. For your own app, let Portolan discover it:

```bash
portolan init --site myapp

# optional, for pages behind auth
portolan auth login --url https://app.example/sign-in \
  --out ./.portolan/state/auth.json

portolan map build --maps ./.portolan/maps --site myapp \
  --url http://localhost:3000 \
  --start "npm run dev" \
  --verify --publish
```

Discovery walks the live DOM, turns pages into states and links/forms into
typed ops, and writes `draft.json`, `tasks.json`, and `capabilities.json` next
to the map. It is read-only; forms are not submitted.

Then work the capability ledger until it is complete:

```bash
portolan map coverage --site myapp --maps ./.portolan/maps
portolan map build --maps ./.portolan/maps --site myapp \
  --url http://localhost:3000 --require-complete --verify --publish
```

For every `missing` or `stale` capability, either record one run through
Portolan (`open_url` -> `view`/`act`/`read` -> `fallback_done`) and rebuild from
traces, or exclude it with a reason. After the app changes, run
`portolan map update`.

`portolan init` also installs `.portolan/skills/portolan-map/SKILL.md`, which gives a
coding agent this loop step by step.

## What works today

- `portolan map build/update` discovers from the live DOM, writes a
  `capabilities.json` ledger, verifies, and publishes.
- `portolan auth login` and `--storage-state` cover pages behind auth.
- `open_url` records a trace for a site with no map yet; the compiler can
  bootstrap a map from traces alone.
- `open_site`, `call`, `view`, `act`, and `read` work through `portolan mcp`.
- `call` runs the operation through the cheapest verified tier: `url`, in-page
  `http`, then `ui`. A write goes through confirmation and idempotency.
- `webmcp` is in the map format but has no executor yet; an operation that only
  has a `webmcp` implementation returns `op_broken`.
- `serve` wires the same browser factory, so the HTTP MCP surface executes
  operations too.

## Where next

- [Using maps](/guide/using-maps) — the call loop an agent runs.
- [Concepts](/guide/concepts) — map, state, op, tier, session.
- [MCP tools](/reference/mcp-tools) — every tool and its result shape.
- [Write safety](/guide/write-safety) — confirmation, idempotency, unknown
  outcomes.
- [Map format](/reference/map-format) — the full field reference.
