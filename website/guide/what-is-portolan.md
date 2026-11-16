# What is Portolan?

Portolan turns a website into a **map an agent can call**.

Instead of handing an agent a screen, a DOM dump, or a list of elements and
asking it to work out, click by click, what a site can do, Portolan gives it
named places and typed operations:

```text
search(query, page=1)                 → [{id, name, price, url}]   read
add_to_cart(product_id, size, qty=1)  → {cart_count, subtotal}     write
view_cart()                           → {items[], subtotal}        read
checkout(shipping_id, payment_id)     → {order_id}                 irreversible
```

A ten-click checkout becomes three calls with typed results. Every click you
remove is a model step you stop paying for — and a failure mode you stop
shipping.

## The two halves

**The map** is the product. It describes one site: its states (`catalog`,
`results`, `cart`, `order`), the operations an agent can call, and the evidence
that each operation works. Maps are learned from real runs, verified by replay,
and repaired when the site changes.

**The runtime** executes the map. It keeps a live session, recognizes the
current state, routes to preconditions, runs the cheapest verified path, and
governs writes.

## What makes it different

| | Browser agent | Portolan |
|---|---|---|
| Unit of work | A click | A typed operation |
| Cost model | One model step per action | One call per intent |
| Page understanding | Model reads the page each step | Map knows the site up front |
| Writes | Retried hopefully | Declared effects, confirmation, idempotency |
| Failure | Start over | Typed errors, fallback scope, repair |

## Cheapest verified path

Every operation has one or more implementations. The runtime picks the first
verified implementation that fits:

1. **`url`** — one navigation to a route template. Read only.
2. **`http`** — the site's own request, made inside the page with its cookies.
   Writes need an `outcome_check`.
3. **`ui`** — a semantic UI program: fill, select, click. Read or write.
4. **`webmcp`** — a tool the page publishes. Reserved; no executor yet.

When no operation fits, the caller's own agent can finish the intent with the
fallback tools (`view`, `act`, `read`). Portolan does not put an LLM in the hot
path: a verified operation runs deterministically.

## What you need

- Node 22.12 or newer.
- Chrome or Chromium.
- Any MCP client: Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI,
  or VS Code.

Portolan is provider- and model-agnostic. Maps are compiled offline through a
`ModelPort` that can reach Anthropic, OpenAI, Google, or any OpenAI-compatible
endpoint — including local models.

## Where to go next

- [Quickstart](/guide/quickstart) — from a clone to a working MCP call.
- [Concepts](/guide/concepts) — map, state, op, tier, session.
- [Connect your agent](/guide/clients) — a snippet per client.
- [Using maps](/guide/using-maps) — the call loop an agent actually runs.
