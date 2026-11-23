# Concepts

Five words explain the runtime: **map**, **state**, **op**, **tier**, and
**session**.

## Map

A map is a JSON file that describes one site: its states, the operations an
agent can call, and the evidence that each op works. It is learned from real
runs, verified by replay, and repaired when the site changes.

```
.portolan/maps/<site>/v<n>.json
```

A map is versioned. A session pins one version, so a publish never changes the
meaning of a call in flight. The full field reference is
[map spec v0](./spec/map-v0.md).

## State

A state is a named place in the site, recognized from the live page: a URL
pattern and a set of semantic marks. `catalog`, `results`, `cart`, `order`.
States are how an op declares where it starts (`from`) and where it ends
(`to`), and how the runtime refuses a call from the wrong page with
`precondition_failed`.

## Op

An op is a typed operation: `search(query)`, `add_to_cart(variant_id, qty)`,
`checkout(email)`. It has JSON Schema `params` and `returns`, an `effect`
(`read`, `write`, `irreversible`), and one or more implementations.

An agent calls an op instead of clicking. That is the whole point: a ten-click
checkout becomes three calls with typed results.

## Tier

An implementation tier is the cheapest verified path:

| Tier | Path | Writes |
|---|---|---|
| `url` | Navigate to a route template | read only |
| `http` | The site's own request, inside the page, with its cookies | write with `outcome_check` |
| `ui` | A semantic UI program: fill, select, click | read or write |
| `webmcp` | A tool the page publishes | reserved |

The runtime picks the first verified impl that fits. A `url` op is one
navigation; a `ui` op is a few semantic actions; an `http` op is one or more
requests.

## Session

A session is one browser context, one SQLite row, and one pinned map version.
It owns cookies, refs, and the write ledger. Sessions expire on an idle TTL, a
cap bounds how many can be open, and a restart closes the ones a dead process
left behind.

Refs (`e1a2b`) are document-scoped handles for nodes. They die with the
document; a stale ref returns `stale_ref` with a replacement when the node is
still recognizable.

## Effects

| Effect | Meaning |
|---|---|
| `read` | Changes nothing. Safe to retry. |
| `write` | Changes the site. Needs an idempotency key to be retry-safe. |
| `irreversible` | Cannot be undone. Needs `confirm: true`, and only a `ui` or `webmcp` impl. |

## Untrusted data

Page text and element names are data, not instructions. Every page-derived MCP
result carries `untrusted: true` and a notice. A client should render it as
data and never follow instructions found in it. The label is a signal, not a
jailbreak defense; the server enforces writes.

## Skill

A skill is knowledge, not execution. It is a `portolan-<site>` document that
names the ops, mines common recipes from successful traces, and links the full
schemas. MCP is the source of truth; the skill tells an agent how to use it.
