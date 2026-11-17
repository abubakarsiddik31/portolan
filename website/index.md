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
4. Ask me for the site name. Then run: portolan init ./portolan --site <site>
5. Check ./portolan/maps/<site>/ for a map version (v*.json). If none exists, stop and tell me: "Portolan needs a map for <site> before it can run operations." Ask whether I want to provide a map, compile one from traces, or use the demo store from the quickstart.
6. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./portolan/maps>
     DATABASE_PATH: <absolute path to ./portolan/portolan.db>
   Detect my harness (OpenCode, Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact file path and snippet.
7. Tell me to restart or reload this session so the Portolan MCP tools load.

Use once the tools and a map are available
8. Call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
9. Use view, act, and read only when no operation fits, then close the fallback scope with fallback_done.
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
