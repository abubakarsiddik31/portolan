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
| `snapshot()` | `{ url, title, nodes }`, one entry per accessibility node |
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

## Not here yet

Semantic ranking, refs, hit-testing, overlays, quiescence and effects are
T2.10–T2.14. This package is the transport, not the model.
