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

## UI tier

`runUiOp({ map, op, params, substrate })` runs a `ui` impl:

- checks the current state is in `op.from`
- resolves each step's locator to a ref and acts through the substrate
- waits for `await_state` steps
- checks every `post` condition
- extracts the return value and validates it with Ajv, coercing strings to the schema's numbers

Supported extractors: `fields`, `rows`, `composite`, `none`. `download` and
`press` are not supported yet.

## Extraction and post-checks

`extract(extractor, view)` is tier-agnostic: `url`, `http`, and `ui` impls all
end with the same extractor.

- `fields` reads a locator's text, `value`, `href`, `name`, or any DOM
  attribute via `attribute`, with an optional capture pattern. Text falls back
  to a node's `StaticText` descendants.
- Extraction includes hidden nodes, so a closed `<select>`'s options are still
  readable.
- `rows` scopes the row locator to the container's descendants and each column
  to the row's descendants, in document order.
- `composite` combines fields and one row list.
- `none` returns `{}`.

`validateReturns(op, value)` validates with Ajv and coerces numeric strings to
the schema's integer types. A schema miss is an op failure, not a pass-through.

`checkPost(check, map, view)` handles `state`, `url`, `exists`, `absent`, and
`text`.

## URL tier

`runUrlOp({ map, op, params, substrate, baseUrl? })` fills a route template,
navigates, checks the postconditions, extracts, and validates.

- `fillRoute` URL-encodes each parameter.
- The base is `baseUrl` or `map.origins[0]`. The override exists for tests and
  proxies where the map's origin is not the address to hit.
- The tier is read-only. A write must use `ui` or `http`, because a navigation
  has no outcome check and no confirmation step.

## HTTP tier

`runHttpOp({ map, op, params, substrate, baseUrl? })` runs the op's steps with
`fetch` inside the live page, so requests use the page's cookies, origin, and
TLS fingerprint.

- `bind` captures a value from a response for a later step
  (`"bind": { "token": "csrf" }`).
- `fillDeep` fills `{param}` placeholders in URLs, headers, and bodies.
- The extractor must be `json` (with an optional dot path) or `none`.
- A non-2xx response is `op_broken` with the status and a truncated body.
- An `http` op is verified by its status and `returns` schema, so the lint does
  not require a DOM post-check.

The fixtures have no CSRF endpoint; the parity test exercises `bind` with a
product name returned by the first request. A CSRF token is the same mechanism.

## Not here yet

Write safety is T2.22–T2.24; download capture is still open.
