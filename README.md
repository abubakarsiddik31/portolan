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

Maps are learned from real runs, verified by replay, and repaired when the
site changes. Portolan works with **any model and any MCP client**: MCP
carries execution and safety, Agent Skills carry the know-how. The same
substrate powers **agent-first QA**: your coding agent authors, runs, and
repairs end-to-end tests as JSON files in your repo.

<details>
<summary><strong>Copy-paste setup prompt for your agent</strong></summary>

Paste this into OpenCode, Claude Code, Codex, Cursor, Gemini CLI, or any
MCP-capable coding agent. It installs Portolan, creates a workspace, and wires the MCP
server.

```text
You are setting up Portolan in this project and then using it to drive websites through typed operations.

Read these pages before you start:
- Overview: https://abubakarsiddik31.github.io/portolan/guide/what-is-portolan
- Quickstart: https://abubakarsiddik31.github.io/portolan/guide/quickstart
- Concepts: https://abubakarsiddik31.github.io/portolan/guide/concepts
- Using maps: https://abubakarsiddik31.github.io/portolan/guide/using-maps
- Write safety: https://abubakarsiddik31.github.io/portolan/guide/write-safety
- Client setup: https://abubakarsiddik31.github.io/portolan/guide/clients
- Skills: https://abubakarsiddik31.github.io/portolan/guide/skills
- Build a map: https://abubakarsiddik31.github.io/portolan/guide/compiling-maps
- MCP tools: https://abubakarsiddik31.github.io/portolan/reference/mcp-tools
- CLI: https://abubakarsiddik31.github.io/portolan/reference/cli
- Configuration: https://abubakarsiddik31.github.io/portolan/reference/configuration
- Map format: https://abubakarsiddik31.github.io/portolan/reference/map-format

Setup
1. Check Node version and Chrome/Chromium. Require Node >= 22.12. If either is missing, tell me what to install and stop.
2. Install the Portolan CLI: npm install -g @abubakarsiddiik/portolan. If global installs are blocked, use npx @abubakarsiddiik/portolan for every command.
3. Run portolan doctor and report the result.
4. Ask me for the site name. Then run: portolan init ./portolan --site <site>. This installs ./portolan/skills/portolan-map/SKILL.md (how to build and keep the map complete) and ./portolan/skills/portolan/SKILL.md (how to use it).
5. Read ./portolan/skills/portolan-map/SKILL.md and follow it until the map is complete. Do not ask me to write JSON.
   - Ask me only for the app URL (or read baseUrl from portolan.config.json) and the dev-server command, if they are not obvious.
   - Run: portolan map build --maps ./portolan/maps --site <site> --url <url> --verify --publish [--start "<dev command>"]
   - For pages behind auth, run portolan auth login --url <sign-in page> --out ./portolan/auth.json, add --storage-state ./portolan/auth.json to every map command, and use the signed-in URL (e.g. /dashboard) as --url.
   - Read the repository's routes, API handlers, forms, and tests. Add capabilities the crawl cannot see:
     portolan map capability add --maps ./portolan/maps --site <site> --page <page> --kind button --name "<label>" --source code
   - Read the gaps: portolan map coverage --maps ./portolan/maps --site <site> --json
   - For every missing or stale capability, either record one run through Portolan (open_url -> view/act/read -> fallback_done, then portolan map build --maps ./portolan/maps --traces-dir ./portolan/traces --site <site> --verify --publish) or exclude it with a reason:
     portolan map capability set --maps ./portolan/maps --site <site> --id <id> --status excluded --reason "<why>"
   - A run in your own browser tool does not reach Portolan. Use the Portolan MCP browser tools so the trace is recorded.
   - Repeat until this passes: portolan map build --maps ./portolan/maps --site <site> --url <url> --require-complete --verify --publish
   - After the app changes, refresh: portolan map update --maps ./portolan/maps --site <site> --url <url> --verify --publish
   - Commit ./portolan/maps/<site>/capabilities.json, draft.json, tasks.json, and v*.json with the app.
   - Only ask me to help when discovery finds nothing to start from or a capability needs a decision only I can make.
   - Use the demo store only if I ask to try Portolan without my app.
6. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./portolan/maps>
     DATABASE_PATH: <absolute path to ./portolan/portolan.db>
     TRACES_DIR: <absolute path to ./portolan/traces>
     PORTOLAN_STORAGE_STATE: <absolute path to ./portolan/auth.json>   # only for authenticated apps
   Detect my harness (OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact file path and snippet.
7. Tell me to restart or reload this session so the Portolan MCP tools load.

Use once the tools and a map are available
8. Call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
9. Use view, act, and read only when no operation fits, then close the fallback scope with fallback_done. If a site has no map, call open_url with a URL and one intent first; that records a trace you can build a map from.
10. Put an idempotency key on every write. Ask me before any irreversible operation. If a call returns unknown_outcome, do not retry; inspect the outcome check and report.
11. If an operation returns needs_confirmation, ask me before re-calling it with confirm: true.
12. After each task, summarize the operations called, the results, and any typed errors.
```

[Full setup guide](https://abubakarsiddik31.github.io/portolan/guide/agent-setup)

</details>

```text
open_site("acme-store")
→ acme-store · map v14 · verified 2h ago · you are in: home (logged_in)
  search(query, page=1)                 → [{id, name, price, url}]       read
  add_to_cart(product_id, size, qty=1)  → {cart_count, subtotal}         write
  view_cart()                           → {items[], subtotal}            read
  checkout(shipping_id, payment_id)     → {order_id}                     irreversible · needs confirm
  fallback: view() / act() / read()
```

## Build a map

Point Portolan at a running app; it discovers pages, links, and forms from the
live DOM (the same DevTools surface) and publishes only what verifies. No
OpenAPI file and no hand-written JSON.

```bash
portolan map build --site herbie \
  --url http://localhost:3000 \
  --start "npm run dev" \
  --verify --publish

# after the app changes
portolan map update --site herbie --url http://localhost:3000 --verify --publish
```

Discovery is read-only. Writes publish only after `--verify-writes` or a
recorded run proves them. Every build writes `draft.json`, `tasks.json`, and
`capabilities.json` next to the map. The capability ledger lists every link,
form, and button the crawl saw; `map coverage` reports what is still missing,
and `--require-complete` refuses to publish until every entry is mapped or
excluded with a reason:

```bash
portolan map coverage --site herbie --maps ./portolan/maps
```

The `portolan-map` skill tells a coding agent how to work that queue from the
codebase and the live app.

For pages behind auth, sign in once with `portolan auth login --url <sign-in page> --out ./portolan/auth.json`, then pass `--storage-state ./portolan/auth.json` (and set `PORTOLAN_STORAGE_STATE` for the MCP server). Portolan never sees the password.

If a site has no link or form to start from, record one run instead: call
`open_url(url, intent)` over MCP, finish the task with `view`/`act`/`read`, then
`fallback_done`. The trace is saved and the next `portolan map build` compiles
it.

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
npm install -g @abubakarsiddiik/portolan
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

## QA your app

The map runtime drives *other* sites. The QA vertical turns the same substrate
on *your* app: your coding agent authors test cases as JSON, runs them
deterministically (no model in the run path), reads typed failures with
evidence, and repairs broken locators after a UI change.

```bash
portolan qa init           # config, qa/cases, skill, MCP snippet
```

Then let the agent work the loop: `qa_plan` after a diff, `qa_run` the
affected cases, `qa_repair` on a moved target, `qa_verify` to promote a case
from draft to verified. Trust lives in a local database, not in the JSON —
editing a case by hand can never forge a pass.

```text
qa_plan  → 2 cases touched by your diff
qa_run   → auth/login: fail · not_found · step 3 (button "Login" is gone)
qa_repair→ recovered {button "Sign in"} · draft rewritten · confirmation pass
qa_verify→ 3 fresh replays, all pass · case promoted to verified
```

See the [QA guide](https://abubakarsiddik31.github.io/portolan/guide/qa) and
[docs/QA.md](./docs/QA.md) for the design and trust model.

## Documentation

Full docs live at **https://abubakarsiddik31.github.io/portolan/**.

| Start here | |
|---|---|
| [What is Portolan?](https://abubakarsiddik31.github.io/portolan/guide/what-is-portolan) | The model in five minutes |
| [Quickstart](https://abubakarsiddik31.github.io/portolan/guide/quickstart) | Clone to a working MCP call |
| [Concepts](https://abubakarsiddik31.github.io/portolan/guide/concepts) | Map, state, op, tier, session |
| [Write safety](https://abubakarsiddik31.github.io/portolan/guide/write-safety) | Confirmation, idempotency, unknown outcomes |
| [Skills](https://abubakarsiddik31.github.io/portolan/guide/skills) | Knowledge, not execution |
| [QA your app](https://abubakarsiddik31.github.io/portolan/guide/qa) | Agent-authored tests, deterministic runs, repair |
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

The map pipeline is complete: compiler, verifier, repair, MCP server, CLI,
packaging, and docs. The **QA vertical** shipped its first milestone — case
authoring and generation, deterministic runs, DB-backed verification, and
locator repair. The current focus is **G0 on one vertical**: proving that
hand-written operations beat a step-by-step browser agent on steps and cost
before building more. See [the build plan](./docs/BUILD_PLAN.md) and
[decisions](./docs/DECISIONS.md).

**v0.2.0** is the current alpha, published to npm as `@abubakarsiddiik/*`
(v0.1.0 was the first public release). The G0–G2 gates have not passed yet, so
treat it as an early alpha: `webmcp` is reserved in the map format and has no
executor.

## Repository map

| Path | What's in it |
|---|---|
| [`packages/`](./packages) | Runtime, substrate, compiler, protocol, server, QA, CLI, skills |
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
