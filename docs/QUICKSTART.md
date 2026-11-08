# Quickstart

From a clone to a working MCP call in about ten minutes. Nothing is published
to npm yet, so this uses the source checkout.

## 1. Prerequisites

- Node 22.12 or newer.
- Google Chrome or Chromium (`CHROME_PATH` if it is not in a usual place).

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

## 3. Start a demo site and a server

The repository ships fixtures. In one terminal:

```bash
pnpm --filter @portolan/bench fixtures:store
```

That serves the store fixture on `http://127.0.0.1:4100`. In a second terminal,
from the repository root:

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

Or use the JSON/TOML snippets in [Install](./INSTALL.md) for Claude Desktop,
Codex CLI, Cursor, Gemini CLI, or VS Code.

## 5. Make a call

Ask the client to call `open_site` with `{ "site": "store" }`. It returns the
compact map:

```
store · map v1
  search(query, page)  Search the catalog.  [read]
  get_product(product_id)  ...
  add_to_cart(...)  [write]
  checkout(...)  [irreversible]
```

Then call `view` to read the page. You should see the catalog, the search box,
and a ranked list of affordances.

That is the loop: `open_site` tells the agent what the site can do, `call`
runs a named op, and `view` / `act` / `read` are the fallback when no op fits.

## 6. Check the install

```bash
node packages/cli/dist/bin.js doctor
```

`doctor` reports the browser, config, provider variables, and client configs.

## What works today

- `open_site`, `view`, `act`, `read`, and the fallback scope work.
- A named `call` returns `op_broken` because the MCP executor is still
  `notReadyExecutor`. The runtime executes ops in tests and benchmarks; the
  server does not wire a live executor yet.

## Where next

- [Concepts](./CONCEPTS.md) — map, state, op, tier, session.
- [MCP setup](./MCP.md) — every tool and its result shape.
- [Write safety](./WRITE-SAFETY.md) — confirmation, idempotency, unknown
  outcomes.
- [Map format](./spec/map-v0.md) — the full field reference.
