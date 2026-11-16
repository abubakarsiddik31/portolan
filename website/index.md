---
layout: home

hero:
  name: Portolan
  text: Chart the web once. Every agent sails it.
  tagline: Turn a website into typed operations your agent can call — with write safety built in.
  image:
    src: /logo.svg
    alt: Portolan
  actions:
    - theme: brand
      text: Get started
      link: /guide/quickstart
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
