# @portolan/runtime

The state machine and, later, the op runtime.

## State recognition

`recognizeState(map, snapshot)` matches a document against a map's states:

- the URL pattern (`/p/:id`, `/search`) must match the pathname
- every `marks` locator must resolve to a visible node
- every `not` locator must be absent

When several states match, the one with more marks wins, then the one with a
URL. A tie keeps declaration order.

Locators resolve against the semantic snapshot: `test_id` matches the author's
`data-testid`, `label` matches a form control by its accessible name, and
`role` matches with optional `name` or `name_re`. `ctx` and `attr` are
extraction hints, not identity, so they are ignored here.

## Routing

`routeTo(map, from, to)` runs a breadth-first search over read ops only. It
returns the shortest op sequence, `[]` when already in the target, or
`undefined` when no read-only path exists. Writes and irreversible ops are
never part of a route: the runtime may route to a precondition, but it never
inserts an action the caller did not ask for.

Broken ops are excluded; degraded ops are still routable.

## Not here yet

Tiers, write safety, and extractors are T2.17–T2.24.
