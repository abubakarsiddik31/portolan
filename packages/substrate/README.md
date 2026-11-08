# @portolan/substrate

The four-method browser adapter. It is the only place the runtime touches a
rendering engine.

```ts
const engine = await PlaywrightEngine.launch({ executablePath });
await engine.navigate(url);
const snapshot = await engine.snapshot(); // raw accessibility tree
await engine.dispatch({ do: "click", backendNodeId });
await engine.evaluate<string>("document.title");
await engine.close();
```

## Methods

| Method | Returns |
|---|---|
| `navigate(url)` | `{ url, title, status }` |
| `snapshot()` | `{ url, title, nodes }`, each node with role, name, bounds, and visibility |
| `dispatch(action)` | `{ ok, url, title }` for click / fill / select / check / uncheck / press |
| `evaluate(expression)` | the page's value |
| `close()` | idempotent |

`dispatch` takes a CDP `backendNodeId`, which `snapshot` provides on every node
that has a DOM counterpart. Clicks use a real mouse event at the centre of the
node's client rect; fills focus the node and insert text; selects and checkbox
toggles go through the element's own setters and dispatch `input` and `change`.

## Chrome

`playwright-core` does not download a browser. Set `CHROME_PATH`, or the adapter
looks in the usual macOS and Linux locations. `findChrome()` returns `undefined`
when none is installed, and the contract tests skip.

`snapshot` merges `Accessibility.getFullAXTree` with
`DOMSnapshot.captureSnapshot`: role and name come from the accessibility
tree, bounds and computed style from the DOM snapshot, joined on
`backendNodeId`. A node is `visible` only when it is not ignored, has a
non-zero box, and is not `display: none`, `visibility: hidden`, or
`opacity: 0`.

## Affordances

`rankAffordances(nodes)` filters the capture to visible, actionable,
measurable nodes, adds the nearest named ancestor or landmark as `ctx`, and
ranks by role weight, name presence, and document order. `renderAffordances`
fits the list into a token budget (default 800) and reports what it dropped.

The fixture tests capture every page the benchmark tasks touch — store
catalog and product, all three wizard steps, portal login and ledger — and
assert the required interactions are present within the budget.

## Refs

`buildRefMap(nodes, doc)` assigns each node a document-scoped ref: `e` plus a
base36 hash of `role|name|framePath|ordinal`. Collisions extend the prefix by
one character until unique.

`RefRegistry` keeps the current and previous maps, so a missing ref resolves to
`stale_ref` with the current document and, when role and name still match, a
`new_ref`. A ref is only valid for the document that produced it;
`snapshot.doc` increments on every committed main-frame navigation.

## Act

`Substrate` composes capture and refs into the two fallback verbs:

```ts
const { refs } = await substrate.view();
await substrate.act({ ref, do: "fill", value: "tee" });
await substrate.act({ ref, do: "click" });
```

`act` resolves the ref, dispatches through the engine, and returns a typed
result: `ok`, `stale_ref` (with `new_ref` when the node moved), `not_interactive`
(with `blocker_ref` when something covers the target), or `invalid_request`.

The engine hit-tests the click point with `DOM.getNodeForLocation` before
dispatching real mouse input, accepting the target, its descendants, and its
ancestors. After a click, check, or press it waits up to 250ms for a main-frame
navigation, then for load and a short network-idle window. A long poll or
animation does not block the caller.

## Effects and delta

`act` returns what the action changed:

- **`effects`**: `navigation`, `network`, and `value`.
  - A `network` effect carries the method, URL, status, resource type, MIME
    type, and parsed JSON request and response bodies. Only requests that
    started during the action are included, so each one is attributed to the
    action that caused it. Bodies over 256 KB are dropped.
- **`delta`**: `{ navigation, entries[] }`, where entries are `added`,
  `removed`, or `changed` nodes by ref.

After an action the substrate re-captures the document and diffs the ref maps.
A navigation returns `{ navigation: true, entries: [] }` because the caller
should re-read. Non-navigation actions return a small diff; the fixture test
asserts it stays under 15% of the document.

## Network capture

`PlaywrightEngine` listens to CDP `Network` events. `requestWillBeSent`
records the method, URL, resource type, and JSON request body; a body CDP did
not inline is fetched with `Network.getRequestPostData`. `responseReceived`
adds the status and MIME type, and `loadingFinished` fetches a JSON response
body with `Network.getResponseBody` before it is evicted.

`dispatch` awaits the captures for the action's requests before returning, so
the effects it reports are complete, not a promise of a body that arrives
later. This is what makes a trace usable for lifting an `http` op: the
request body is the template, and the response body is what `returns` can be
inferred from.

## Egress policy

`loadPolicy(site)` reads `policies/<site>.json`. Pass it to the substrate:

```ts
const substrate = new Substrate(engine, {
  policy: loadPolicy("store"),
  onBlocked: (event) => log.warn(event),
});
```

The guard is default-deny. `fetch` (the in-page `http` tier and fallback) and
`goto` (the `url` tier) are checked before they reach the page. A blocked
request throws `EgressBlockedError`, is kept in `blockedRequests()`, and is
passed to `onBlocked`. A page's own navigation is not intercepted by this
layer.

## Not here yet

This package is the transport, the capture, the addressing layer, and the
fallback verbs. The op runtime and the compiler are separate packages.
