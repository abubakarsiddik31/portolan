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

Paste this into Claude Code, Codex, Cursor, Gemini CLI, or any MCP-capable
coding agent. It installs Portolan, creates a workspace, and wires the MCP
server.

```text
You are setting up Portolan in this workspace, then using it.

Setup
1. Check Node version and Chrome/Chromium. Require Node >= 22.12. If either is missing, tell me what to install and stop.
2. Install the Portolan CLI: npm install -g @abubakarsiddiik/portolan. If global installs are blocked, use npx @abubakarsiddiik/portolan for every command instead.
3. Run portolan doctor and report the result.
4. Ask me for the site name. Then run: portolan init ./portolan --site <site>
5. Configure my MCP client for this harness to spawn:
   command: portolan
   args: ["mcp"]
   env:
     MAPS_DIR: <absolute path to ./portolan/maps>
     DATABASE_PATH: <absolute path to ./portolan/portolan.db>
   Detect the harness (Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, or VS Code) and use its config format. If you cannot safely edit the config, print the exact snippet and file path.
6. Tell me to restart this session so the Portolan tools load.

Use
7. After the restart, call open_site with the site name. Read the returned map and use call for named operations. Never invent operation names or parameters.
8. Use view, act, and read only when no operation fits, and close the fallback scope with fallback_done.
9. Include an idempotency key on writes. Ask me before any irreversible operation. If a call returns unknown_outcome, do not retry; inspect the outcome check and report.
10. After each task, summarize the operations called, results, and any errors.
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
