# Quickstart

From a clone to a working MCP call in about ten minutes. The CLI is published
to npm, but this guide uses the source checkout so you can run the demo
fixtures.

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
pnpm --filter @abubakarsiddiik/bench fixtures:store
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

- `open_site`, `call`, `view`, `act`, and `read` work through `portolan mcp`.
- `call` runs the op through the cheapest verified tier: `url`, in-page
  `http`, then `ui`. A write goes through confirmation and idempotency.
- `webmcp` is in the map format but has no executor yet; an op that only has
  a `webmcp` impl returns `op_broken`.
- `serve` wires the same browser factory, so the HTTP MCP surface executes
  ops too.

## Where next

- [Concepts](./CONCEPTS.md) — map, state, op, tier, session.
- [MCP setup](./MCP.md) — every tool and its result shape.
- [Write safety](./WRITE-SAFETY.md) — confirmation, idempotency, unknown
  outcomes.
- [Map format](./spec/map-v0.md) — the full field reference.
