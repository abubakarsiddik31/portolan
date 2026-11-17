<p align="center">
  <img src="assets/logo.svg" width="96" alt="Portolan logo">
</p>

<h1 align="center">Portolan</h1>

<p align="center">
  <strong>Chart the web once. Every agent sails it.</strong>
</p>

<p align="center">
  <a href="https://github.com/abubakarsiddik31/portolan/actions/workflows/ci.yml"><img src="https://github.com/abubakarsiddik31/portolan/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://abubakarsiddik31.github.io/portolan/"><img src="https://img.shields.io/badge/docs-live-0E3B33" alt="Docs"></a>
  <a href="https://github.com/abubakarsiddik31/portolan/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0E3B33" alt="License"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-0E3B33" alt="MCP"></a>
  <img src="https://img.shields.io/badge/status-alpha-E7C987" alt="Alpha">
</p>

Portolan turns a website into a **map an agent can call**: the site's states,
and typed operations like `search(query)`, `add_to_cart(product_id, size)` or
`export(filter)` that move between them. Agents call operations instead of
looking at screens and clicking.

Maps are learned from real runs, verified by replay, and repaired when the site
changes. Portolan works with **any model and any MCP client**: MCP carries
execution and safety, Agent Skills carry the know-how.

```text
open_site("acme-store")
→ acme-store · map v14 · verified 2h ago · you are in: home (logged_in)
  search(query, page=1)                 → [{id, name, price, url}]       read
  add_to_cart(product_id, size, qty=1)  → {cart_count, subtotal}         write
  view_cart()                           → {items[], subtotal}            read
  checkout(shipping_id, payment_id)     → {order_id}                     irreversible · needs confirm
  fallback: view() / act() / read()
```

## Why Portolan

- **Operations, not clicks.** A ten-click checkout becomes three calls with
  typed results. Every click you remove is a model step you stop paying for.
- **Cheapest verified path.** Each op runs through the cheapest path that has
  been verified — a URL, the site's own API request, or a semantic UI program.
- **Writes are governed.** Effects are declared, irreversible operations need
  confirmation, and a write with an unknown outcome is never silently retried.
- **Any model, any client.** Provider-agnostic by design, with a portable MCP
  surface and generated Agent Skills per site.
- **Stateful sessions.** A map needs a live session to recognize state, route
  to preconditions, and run UI operations.
- **Human in the loop.** Agents use the map; humans watch the same session and
  can take over.

## Quickstart

Requires Node 22.12+ and Chrome or Chromium.

Install the published CLI:

```bash
npm install -g @abubakarsiddiik/cli
portolan init ./my-site
```

Or run from source:

```bash
git clone https://github.com/abubakarsiddik31/portolan.git
cd portolan
pnpm install
pnpm build
```

Start the demo store and the MCP server:

```bash
# terminal 1
pnpm --filter @abubakarsiddiik/bench fixtures:store

# terminal 2
DATABASE_PATH=:memory: MAPS_DIR=maps node packages/cli/dist/bin.js mcp
```

Connect a client, then call `open_site` with `{ "site": "store" }`:

```bash
claude mcp add portolan -- env MAPS_DIR="$PWD/maps" DATABASE_PATH=:memory: \
  node "$PWD/packages/cli/dist/bin.js" mcp
```

The [Quickstart guide](https://abubakarsiddik31.github.io/portolan/guide/quickstart)
walks through the rest of the loop.

## Connect your agent

Portolan speaks MCP over stdio or streamable HTTP. Use the same server from
Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code.

```json
{
  "mcpServers": {
    "portolan": {
      "command": "portolan",
      "args": ["mcp"],
      "env": {
        "MAPS_DIR": "/absolute/path/to/maps",
        "DATABASE_PATH": "/absolute/path/to/portolan.db"
      }
    }
  }
}
```

See [Client setup](https://abubakarsiddik31.github.io/portolan/guide/clients) for
a snippet per client.

## Documentation

Full docs live at **https://abubakarsiddik31.github.io/portolan/**.

| Start here | |
|---|---|
| [What is Portolan?](https://abubakarsiddik31.github.io/portolan/guide/what-is-portolan) | The model in five minutes |
| [Quickstart](https://abubakarsiddik31.github.io/portolan/guide/quickstart) | Clone to a working MCP call |
| [Concepts](https://abubakarsiddik31.github.io/portolan/guide/concepts) | Map, state, op, tier, session |
| [Write safety](https://abubakarsiddik31.github.io/portolan/guide/write-safety) | Confirmation, idempotency, unknown outcomes |
| [Skills](https://abubakarsiddik31.github.io/portolan/guide/skills) | Knowledge, not execution |
| [MCP tools](https://abubakarsiddik31.github.io/portolan/reference/mcp-tools) | Tool inputs, results, and errors |
| [Map format](https://abubakarsiddik31.github.io/portolan/reference/map-format) | The full field reference |
| [Configuration](https://abubakarsiddik31.github.io/portolan/reference/configuration) | Every option and default |

## How it fits together

```text
Agent (any model, any MCP client)
  │  MCP: open_site · call · view · act · read
  ▼
Portolan server ── map store ── write ledger ── audit log
  │
  ├─ url tier   → one navigation
  ├─ http tier  → the site's own request, with its cookies
  └─ ui tier    → a semantic UI program
       │
       └─ Browser substrate (Playwright / Chromium)
```

Portolan is not a browser for agents. It is an API layer for websites that
happens to run on one.

## Project status

**Early build. Open source. The gates have not been run yet.**

Phase 5 code is complete: compiler, verifier, repair, MCP server, CLI,
packaging, and docs. The current focus is **G0 on one vertical** — proving that
hand-written operations beat a step-by-step browser agent on steps and cost
before building more. See [the build plan](./docs/BUILD_PLAN.md) and
[decisions](./docs/DECISIONS.md).

**v0.1.0** is the first public alpha, published to npm as
`@abubakarsiddiik/*`. The G0–G2 gates have not passed yet, so treat it as an
early alpha: `webmcp` is reserved in the map format and has no executor.

## Repository map

| Path | What's in it |
|---|---|
| [`packages/`](./packages) | Runtime, substrate, compiler, protocol, server, CLI, skills |
| [`maps/`](./maps) | Site maps and the held-out fixtures |
| [`bench/`](./bench) | Benchmarks and the scripted evidence |
| [`docs/`](./docs) | Design, plans, decisions, and the map spec |
| [`website/`](./website) | The documentation site |
| [`skills/`](./skills) | Portable Agent Skills |
| [`policies/`](./policies) | Egress policies |

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first. One task, one branch, one PR.
Commit messages follow Conventional Commits.

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security policy](./SECURITY.md)
- [Open issues](https://github.com/abubakarsiddik31/portolan/issues)

## License

Apache-2.0 for the runtime, SDK, CLI, and skills. MIT for the human cockpit.
CC-BY-4.0 for the published map spec. See [LICENSE](./LICENSE),
[LICENSE-MIT](./LICENSE-MIT), [LICENSE-CC-BY-4.0](./LICENSE-CC-BY-4.0), and
[docs/LICENSING.md](./docs/LICENSING.md).
