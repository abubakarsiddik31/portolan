---
layout: home
titleTemplate: false

hero:
  name: Portolan
  text: Chart the web once. Every agent sails it.
  tagline: Turn a website into typed operations your agent can call — with write safety built in.
  image:
    src: /logo.svg
    alt: Portolan
  actions:
    - theme: brand
      text: Set up with your agent
      link: /guide/agent-setup
    - theme: alt
      text: What is Portolan?
      link: /guide/what-is-portolan

features:
  - title: Operations, not clicks
    details: A ten-click checkout becomes three calls with typed results. Every click you remove is a model step you stop paying for.
  - title: Cheapest verified path
    details: Each operation runs through the cheapest verified tier — a URL, the site's own API request, or a semantic UI program.
  - title: Writes are governed
    details: Effects are declared. Irreversible operations need confirmation. A write with an unknown outcome is never silently retried.
  - title: Any model, any client
    details: MCP carries execution and safety. Agent Skills carry the know-how. Works with Claude, Codex, Cursor, Gemini, and VS Code.
  - title: Stateful sessions
    details: A live session recognizes state, routes to preconditions, and runs UI operations. Maps are versioned and pinned per session.
  - title: Human in the loop
    details: Agents use the map; humans watch the same session and can take over at any point.
---

## Set up with your agent

Paste this into OpenCode, Claude Code, Codex, Cursor, Gemini CLI, or any
MCP-capable coding agent. It installs Portolan, creates a workspace, and wires the MCP
server.

```text
You are setting up Portolan in this project, building a complete map of the app, keeping that map in sync, and then using it to drive the app through typed operations.

Building and syncing the map are the goal, not an optional follow-up. Do not stop after installing the CLI or calling one operation.

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
5. Read ./portolan/skills/portolan-map/SKILL.md and follow it until the map is complete and in sync. Do not ask me to write JSON.
   - Ask me only for the app URL (or read baseUrl from portolan.config.json) and the dev-server command, if they are not obvious.
   - Build from the live app: portolan map build --maps ./portolan/maps --site <site> --url <url> --verify --publish [--start "<dev command>"]
   - For pages behind auth, run portolan auth login --url <sign-in page> --out ./portolan/auth.json, add --storage-state ./portolan/auth.json to every map command, and use the signed-in URL (e.g. /dashboard) as --url.
   - Inventory the app from BOTH the repository and the live app. Read routes, API handlers, forms, buttons, menus, and existing tests. If you have no repository access, browse the app itself and treat every page, link, form, and button you find as a capability.
   - You may use your own browser tool for reconnaissance. That does not record a Portolan trace. When a capability must become an op, record one run through Portolan's MCP browser tools: open_url(url, intent) or open_site(site) -> fallback_begin -> view/act/read -> fallback_done. Then rebuild with --traces-dir. A run in your own browser tool cannot become an op.
   - Add capabilities the crawl cannot see: portolan map capability add --maps ./portolan/maps --site <site> --page <page> --kind button --name "<label>" --source code. Omit --source for capabilities you found by browsing.
   - Read the gaps: portolan map coverage --maps ./portolan/maps --site <site> --json
   - For every missing or stale capability, either record one Portolan run as above and rebuild, or exclude it with a reason:
     portolan map capability set --maps ./portolan/maps --site <site> --id <id> --status excluded --reason "<why>"
   - Repeat until this passes: portolan map build --maps ./portolan/maps --site <site> --url <url> --require-complete --verify --publish
   - Keep the map in sync after every app change: portolan map update --maps ./portolan/maps --site <site> --url <url> --verify --publish, then rebuild from traces for anything the crawl cannot see and re-check coverage.
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

[Full setup guide →](/guide/agent-setup)

## What an agent sees

```text
open_site("acme-store")
→ acme-store · map v14 · verified 2h ago · you are in: home (logged_in)
  search(query, page=1)                 → [{id, name, price, url}]       read
  add_to_cart(product_id, size, qty=1)  → {cart_count, subtotal}         write
  view_cart()                           → {items[], subtotal}            read
  checkout(shipping_id, payment_id)     → {order_id}                     irreversible · needs confirm
  fallback: view() / act() / read()
```

Portolan is not a browser for agents. It is an API layer for websites that
happens to run on one.

## Start here

| | |
|---|---|
| [What is Portolan?](/guide/what-is-portolan) | The model in five minutes. |
| [Quickstart](/guide/quickstart) | From a clone to a working MCP call. |
| [Connect your agent](/guide/clients) | A snippet for every major client. |
| [Using maps](/guide/using-maps) | The call loop an agent runs. |
| [Write safety](/guide/write-safety) | Confirmation, idempotency, unknown outcomes. |
| [Map format](/reference/map-format) | The full field reference. |
