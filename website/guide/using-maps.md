# Using maps with an agent

The loop is small: open a site, read the map, call operations, fall back only
when nothing fits.

## 0. No map yet?

Call `open_url` with the app URL and one intent. It creates an explore session
and a fallback scope, so `view`, `act`, and `read` record a trace immediately.
Close the scope with `fallback_done`, then build a map from what you recorded:

```bash
portolan map build --site herbie --url http://localhost:3000
```

You can also discover a first map without an agent:

```bash
portolan map build --site herbie --url http://localhost:3000 --verify --publish
```

## 1. Open the site

```json
{ "site": "store" }
```

`open_site` pins a map version, creates a session, and returns the compact map:

```text
store · map v1 · you are in: catalog
  search(query, page=1)          → {results[]}            read
  get_product(product_id)        → {id, name, price}      read
  add_to_cart(product_id, qty=1) → {cart_count}           write
  checkout(email)                → {order_id}             irreversible · needs confirm
  fallback: view() / act() / read()
```

The map is the source of truth. Use the operation names and parameter schemas
from the response; do not guess.

## 2. Call an operation

```json
{
  "op": "search",
  "params": { "query": "linen shirt" }
}
```

`call` returns the operation's typed result. A read runs through the cheapest
verified tier and costs no model step beyond the call itself.

A write should carry an idempotency key so a retry cannot duplicate it:

```json
{
  "op": "add_to_cart",
  "params": { "product_id": "sku_104", "qty": 1 },
  "idempotency_key": "cart-add-sku_104-1"
}
```

Use one key per logical intent, not per attempt.

## 3. Fall back when no operation fits

If the map has no operation for the intent, use the fallback tools inside a
fallback scope:

```text
view()                         → ranked affordances with refs
act({ ref, do, value })        → one semantic action
read({ ref })                  → one element's value
fallback_done({ scope_id })    → close the scope and return the trace
```

The trace is how the map gets better: compile it into the next map version.

## 4. Handle typed errors

Every failure is a typed envelope:

```json
{ "ok": false, "error": { "code": "precondition_failed", "message": "..." } }
```

| Code | What the agent should do |
|---|---|
| `precondition_failed` | Read the current state and route to a valid one. |
| `needs_confirmation` | Re-call the irreversible op with `confirm: true`. |
| `needs_auth` | Sign in, then retry. |
| `unknown_outcome` | **Do not retry.** Read the outcome check. |
| `stale_ref` | Re-read and use the replacement ref. |
| `op_broken` | Fall back to `view` / `act` / `read`. |

## 5. Close the session

Sessions expire on an idle TTL and are capped per server. Close one explicitly
when the task is done, or let the TTL sweep it.

## Give the agent a skill

A skill is knowledge, not execution. It tells an agent when and how to use a
site's operations, which recipes are common, and what gotchas a repair found.
Export one from a map:

```bash
portolan export-skills --map maps/store/v1.json --out skills
```

The agent still calls MCP for every action; the skill only improves how it
chooses. See [Skills](/guide/skills).

## A good agent prompt

```text
You have Portolan tools. Call open_site once, then use `call` for any
operation in the returned map. Do not guess operation names or parameters.
If `call` returns precondition_failed, read the current state and route to a
valid one. If it returns unknown_outcome, do not retry: inspect the outcome
check. Use view/act/read only when no operation fits, and close the fallback
scope with fallback_done.
```
