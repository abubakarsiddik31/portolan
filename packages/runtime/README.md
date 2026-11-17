# @abubakarsiddiik/runtime

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

## Write safety

`runWrite` wraps a write:

- `irreversible` requires `confirm: true`.
- A completed idempotency key returns the stored result without executing.
- A pending key is reconciled with the op's `outcome_check`; without a check,
  a pending key returns `unknown_outcome` instead of risking a duplicate.
- A failure after input was dispatched is never retried blindly: the check
  decides `done`, `not_done`, or `unknown_outcome`.

`MemoryWriteLedger` is the default; a durable ledger is the audit work.

The bench test forces a mid-write failure on the store: the request reaches
the server, the response is lost, `runWrite` returns `unknown_outcome`, and a
retry with the same key creates no second order.

## Fallback scopes

`FallbackScopes` opens a permission slip for the caller's agent to finish an
intent with `view`, `act`, and `read`:

- `begin({ sid, intent, effect })` returns `{ scope_id, allowed, expires }`.
- While a write or irreversible scope is open, `blocksWrite(sid)` returns it,
  and the runtime refuses other write ops.
- `close(scope_id, result?)` closes it, stamps `ended_at`, and keeps the result.
- `record(scope_id, entry)` appends a `view`, `act`, or `read` entry to the
  scope's trace. It refuses once the scope is closed.

Each entry carries what the compiler needs: the locator (`role`, `name`,
`ordinal`), the value or key, the document and mutation counters, the URL,
the map state before and after, the effects, and the delta. Network effects
carry parsed JSON request and response bodies, attributed to the action that
caused them. The trace is the raw material for segmenting a fallback run into
ops.

Scopes expire after 10 minutes by default.

## Trace storage

`TraceStore` writes each finished trace as one JSON line to
`<dir>/traces.jsonl` and exports its network effects as HAR 1.2 to
`<dir>/<scope_id>.har`.

- `append(trace)` adds a line; nothing is ever rewritten.
- `all()` reads every trace back in append order.
- `get(scope_id)` returns the last trace for that scope.
- `writeHar(trace)` derives HAR from the same trace.

JSONL is the source of truth and reloads losslessly. HAR is a projection:
view and read entries do not appear, and request timings are zero because the
engine settles on network idle rather than timing each request.

## Redaction

`redactRecord` replaces credential keys (`password`, `card`, `token`, `secret`,
`api_key`, `authorization`, and similar) recursively. `redactTrace` also
redacts the value of an action whose accessible name is a credential, a later
read of that ref, and the request and response bodies of its network effects.

`TraceStore` applies `redactTrace` before writing JSONL and before exporting
HAR, so a login request body or a password fill cannot survive in either. The
audit log applies `redactRecord` at the storage boundary.

## Not here yet

A durable write ledger and the audit log are T2.23–T2.24; download capture is
still open.
