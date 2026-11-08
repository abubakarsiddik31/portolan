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

## Not here yet

The router, tiers, write safety, and extractors are T2.16–T2.24.
