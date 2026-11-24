# Portolan site map — version 0

Status: draft, version 0. The machine-readable schema is
`packages/protocol/src/map/schema.ts` (`$id:
https://portolan.dev/schema/map-v0.json`); this document explains it.

A map is JSON. A loader validates it against the schema, then runs the
cross-field rules in `packages/protocol/src/map/load.ts`. A map that passes both
is what the runtime executes. Unknown fields are rejected: a typo should fail
loudly, not silently disable an op.

## Top level

| Field | Type | Required | Meaning |
|---|---|---|---|
| `site` | string, `^[a-z0-9][a-z0-9-]*$`, ≤64 | yes | Site id; also the directory name under `maps/`. |
| `origins` | string[], ≥1, each `http(s)://` | yes | Origins the map may address, in preference order. |
| `version` | integer ≥1 | yes | Map version. A session pins one. |
| `states` | `State[]`, ≥1 | yes | Named states an op can start or end in. |
| `ops` | `Op[]`, ≥1 | yes | The operations an agent may call. |
| `entities` | object of JSON Schema | yes | Named return shapes shared by ops. |
| `auth` | `Auth` | no | The signed-out state and the op that signs in. |
| `compiled_from` | string[] | yes | Trace or run ids this map was learned from. |
| `verified_at` | string, ≥1 | yes | ISO timestamp of the last verification run. |

### `Auth`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `state` | state id | yes | The state that means "signed out". |
| `login_op` | op id | yes | The op that signs in. |

## `State`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `^[a-z][a-z0-9_]*$` | yes | State id, unique in the map. |
| `url` | string | no | URLPattern-style path, e.g. `/p/:id`. |
| `marks` | `Locator[]` | yes | Every locator must be present to be in this state. Empty means the URL alone identifies it. |
| `not` | `Locator[]` | no | Every locator must be absent. |

## `Op`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | op id | yes | Unique. This is what `call` takes. |
| `version` | integer ≥1 | yes | Op revision. |
| `summary` | string, 1–200 | yes | One line for the agent's map view. |
| `params` | JSON Schema | yes | Validated before execution. |
| `returns` | JSON Schema | yes | The result is validated against it. |
| `from` | state id[], ≥1 | yes | States the op may start in. |
| `to` | state id[], ≥1 | yes | States it may end in. |
| `post` | `PostCheck[]` | yes | Checked after the impl runs. |
| `effect` | `read` \| `write` \| `irreversible` | yes | Drives the safety path. |
| `outcome_check` | op id | no | A **read** op that proves whether a write happened. |
| `confirm` | boolean | no | Must be `true` for `irreversible`. |
| `impls` | `Impl[]`, ≥1 | yes | In preference order; only verified impls run. |
| `status` | `verified` \| `degraded` \| `broken` | yes | Health of the op. |

### Write rules

The loader enforces these beyond the schema:

- An `irreversible` op must set `confirm: true`.
- An `irreversible` op may use only `webmcp` or `ui` impls.
- A `write` op may not use a `url` impl.
- A `write` op with an `http` impl must set `outcome_check`.
- `outcome_check` must name a `read` op.
- Every `from`, `to`, `post.state`, and `await_state` state must exist.
- Op names and state ids are unique.

### `OpContext`

An op's optional `context` keeps what a name and a summary cannot: where the control is and what
it did. Two `click_delete` ops, one in a row and one in a "Danger zone" panel, are the same
sentence without it.

| Field | Type | Meaning |
|---|---|---|
| `intent` | string | The goal the op was recorded for, in the recorder's words. |
| `page` | string | The page's heading or title, or its path. |
| `section` | string | The named dialog, form, panel or table the control sits in. |
| `control` | string | The control as a person sees it, such as a button's label. |
| `subject` | string | What the control acts on when it sits in a row or card. |
| `observed` | string[] | What changed when it ran: requests, pages reached, messages shown. |

`map build` fills it from the page's structure (heading, nearest named region, the row or card)
and from the recorded run (the goal, the API calls, the messages that appeared). A recorded op
whose summary would only say "Recorded: click Save." gets the goal as its summary. `open_site`
and the native tool descriptions show it, and `map lint` warns about a parameterless `ui` op that
has none.

## `Locator`

A locator is semantic, never a CSS selector and never a ref. Use exactly one of
`role`, `label`, or `test_id`:

| Field | Type | Meaning |
|---|---|---|
| `role` | string | Accessible role, e.g. `button`, `textbox`. |
| `label` | string | Form label, resolved like `getByLabel`. |
| `test_id` | string | A stable automation hook the app publishes. |
| `name` | string | Accessible name; requires `role`. |
| `name_re` | string | Accessible-name regex; requires `role`. |
| `ctx` | string | Human hint for disambiguation. |
| `ordinal` | integer ≥0 | Which match to use. |
| `attr` | `name` \| `value` \| `text` \| `href` | Which value to read in an extractor. |
| `attribute` | string | Read an arbitrary DOM attribute, e.g. `data-status`. |
| `pattern` | string | Regex applied to the extracted string; capture group 1 (or the whole match) becomes the value. |

`name` and `name_re` are mutually exclusive. A bad `pattern` fails the load.

## `Extractor`

The result of an impl. Exactly one `kind`:

| `kind` | Required fields | Meaning |
|---|---|---|
| `fields` | `fields` (name → locator, ≥1) | Scalar fields. |
| `rows` | `container`, `row`, `cols` (≥1) | A list of rows. |
| `composite` | `fields` and/or `rows` | Scalars plus one row list under `rows.as`. |
| `json` | `path?` | Dot path into the last HTTP body; empty means the whole body. |
| `download` | — | The downloaded file is the result. |
| `none` | — | The result is an empty object. |

## `Impl`

In preference order. The first verified impl that fits the state runs.

| `tier` | Fields | Meaning |
|---|---|---|
| `webmcp` | `tool` | Call a page-provided tool. |
| `url` | `route`, `extract` | Navigate to a route template. Read-only. |
| `http` | `steps`, `extract`, `auth`? | Run requests inside the page, with its cookies or its token. |
| `ui` | `steps`, `extract` | Act through the semantic UI. |

A `url` route must start with `/` or `http`. `{param}` placeholders are filled
and URL-encoded.

### `HttpStep`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `method` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `HEAD` | yes | HTTP method. |
| `url` | string | yes | Route template or absolute URL. |
| `headers` | object of string | no | Header templates. |
| `body` | any | no | Body template; strings fill `{param}` recursively. |
| `bind` | object of string | no | Capture a value from this response for later steps; the value is a dot path. |

### `HttpAuth`

An `http` impl's optional `auth` says where the site keeps the credential its own frontend
sends, so a request to an API on another origin carries it. It is a reference: the value is read
from the live page when the op runs, so a refreshed token keeps working and nothing secret is
stored in the map.

| Field | Type | Meaning |
|---|---|---|
| `kind` | `cookie` \| `bearer` | `cookie` sends the browser's cookies, including to another origin. `bearer` adds a token header. |
| `source` | `localStorage` \| `sessionStorage` \| `cookie` | Where the page keeps the token (`bearer`). |
| `key` | string | The storage key or cookie name. |
| `path` | string | Dot path inside a JSON value, for a persisted store such as `state.token`. |
| `header` | string | Header the token travels in. Default `authorization`. |
| `scheme` | string | Prefix before the token. Default `Bearer`; `""` sends it bare. |

`map build` fills `auth` from the requests it records: when a request carries an
`Authorization` header, the token is looked up in the page's storage and only its location is
kept. If the token is not there when the op runs, the op fails with `auth_missing` and asks for a
new sign-in.

### `UiStep`

| `do` | Fields | Meaning |
|---|---|---|
| `click` \| `check` \| `uncheck` | `target` | Act on a locator. |
| `fill` \| `select` | `target`, `value` | Set a value; `{param}` is filled. |
| `press` | `key` | Press a key. |
| `await_state` | `state`, `timeout_ms?` | Wait for a state. |

## `PostCheck`

| `kind` | Fields | Meaning |
|---|---|---|
| `url` | `pattern` | The path matches the regex. |
| `state` | `state` | The page is in this state. |
| `exists` | `locator` | The locator is present. |
| `absent` | `locator` | The locator is not present. |
| `text` | `locator`, `contains` | The locator's text contains the string. |

## Example: read-only

```json
{
  "site": "acme",
  "origins": ["https://acme.example"],
  "version": 1,
  "states": [
    {
      "id": "home",
      "url": "/",
      "marks": [{ "role": "textbox", "name": "Search" }]
    },
    {
      "id": "results",
      "url": "/search",
      "marks": [{ "test_id": "product-grid" }]
    }
  ],
  "ops": [
    {
      "name": "search",
      "version": 1,
      "summary": "Search the catalog.",
      "params": {
        "type": "object",
        "properties": { "query": { "type": "string", "minLength": 1 } },
        "required": ["query"],
        "additionalProperties": false
      },
      "returns": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" }
          },
          "required": ["id", "name"],
          "additionalProperties": false
        }
      },
      "from": ["home", "results"],
      "to": ["results"],
      "post": [{ "kind": "state", "state": "results" }],
      "effect": "read",
      "impls": [
        {
          "tier": "url",
          "route": "/search?q={query}",
          "extract": {
            "kind": "rows",
            "container": { "test_id": "product-grid" },
            "row": { "role": "article" },
            "cols": {
              "id": { "role": "link", "attribute": "href", "pattern": "/p/([^/]+)$" },
              "name": { "role": "link" }
            }
          }
        }
      ],
      "status": "verified"
    }
  ],
  "entities": {},
  "compiled_from": ["trace-1"],
  "verified_at": "2026-11-09T00:00:00.000Z"
}
```

## Example: writes

```json
{
  "site": "shop",
  "origins": ["https://shop.example"],
  "version": 3,
  "states": [
    { "id": "product", "url": "/p/:id", "marks": [{ "test_id": "product-detail" }] },
    { "id": "cart", "url": "/cart", "marks": [{ "test_id": "cart-table" }] },
    { "id": "order", "url": "/order/:id", "marks": [{ "test_id": "order-id" }] }
  ],
  "ops": [
    {
      "name": "add_to_cart",
      "version": 1,
      "summary": "Add a variant to the cart.",
      "params": {
        "type": "object",
        "properties": {
          "variant_id": { "type": "string", "minLength": 1 },
          "qty": { "type": "integer", "minimum": 1 }
        },
        "required": ["variant_id", "qty"],
        "additionalProperties": false
      },
      "returns": { "type": "object", "properties": {}, "additionalProperties": false },
      "from": ["product"],
      "to": ["cart"],
      "post": [{ "kind": "state", "state": "cart" }],
      "effect": "write",
      "impls": [
        {
          "tier": "ui",
          "steps": [
            { "do": "select", "target": { "label": "Size" }, "value": "{variant_id}" },
            { "do": "fill", "target": { "label": "Quantity" }, "value": "{qty}" },
            { "do": "click", "target": { "role": "button", "name": "Add to cart" } },
            { "do": "await_state", "state": "cart" }
          ],
          "extract": { "kind": "none" }
        }
      ],
      "status": "verified"
    },
    {
      "name": "submit_order",
      "version": 1,
      "summary": "Submit the cart as an order.",
      "params": {
        "type": "object",
        "properties": { "cart_id": { "type": "string", "minLength": 1 } },
        "required": ["cart_id"],
        "additionalProperties": false
      },
      "returns": {
        "type": "object",
        "properties": { "order_id": { "type": "string" } },
        "required": ["order_id"],
        "additionalProperties": false
      },
      "from": ["cart"],
      "to": ["order"],
      "post": [],
      "effect": "write",
      "outcome_check": "order_status",
      "impls": [
        {
          "tier": "http",
          "steps": [
            {
              "method": "POST",
              "url": "/api/orders",
              "headers": { "content-type": "application/json" },
              "body": { "cart_id": "{cart_id}" },
              "bind": { "order_id": "order.id" }
            }
          ],
          "extract": { "kind": "json", "path": "order" }
        }
      ],
      "status": "verified"
    },
    {
      "name": "order_status",
      "version": 1,
      "summary": "Read an order's status.",
      "params": {
        "type": "object",
        "properties": { "order_id": { "type": "string", "minLength": 1 } },
        "required": ["order_id"],
        "additionalProperties": false
      },
      "returns": {
        "type": "object",
        "properties": { "order_id": { "type": "string" }, "state": { "type": "string" } },
        "required": ["order_id", "state"],
        "additionalProperties": false
      },
      "from": ["order"],
      "to": ["order"],
      "post": [],
      "effect": "read",
      "impls": [
        {
          "tier": "http",
          "steps": [{ "method": "GET", "url": "/api/orders/{order_id}" }],
          "extract": { "kind": "json", "path": "" }
        }
      ],
      "status": "verified"
    },
    {
      "name": "checkout",
      "version": 1,
      "summary": "Place the order.",
      "params": {
        "type": "object",
        "properties": { "email": { "type": "string", "minLength": 3 } },
        "required": ["email"],
        "additionalProperties": false
      },
      "returns": {
        "type": "object",
        "properties": { "order_id": { "type": "string" } },
        "required": ["order_id"],
        "additionalProperties": false
      },
      "from": ["cart"],
      "to": ["order"],
      "post": [{ "kind": "state", "state": "order" }],
      "effect": "irreversible",
      "confirm": true,
      "impls": [
        {
          "tier": "ui",
          "steps": [
            { "do": "fill", "target": { "label": "Email" }, "value": "{email}" },
            { "do": "click", "target": { "role": "button", "name": "Place order" } },
            { "do": "await_state", "state": "order" }
          ],
          "extract": {
            "kind": "fields",
            "fields": { "order_id": { "test_id": "order-id", "attr": "text" } }
          }
        }
      ],
      "status": "verified"
    }
  ],
  "entities": {
    "Order": {
      "type": "object",
      "properties": { "order_id": { "type": "string" } },
      "required": ["order_id"],
      "additionalProperties": false
    }
  },
  "compiled_from": ["trace-2", "trace-3"],
  "verified_at": "2026-11-09T00:00:00.000Z"
}
```

The write example is deliberately conservative: `add_to_cart` is a `ui` write,
`submit_order` is an `http` write with an `outcome_check`, and `checkout` is
`irreversible` with `confirm: true` and a `ui` impl. The loader rejects any
other combination.

## Versioning

`version` on the map and on each op is the compatibility contract. A client
pins a map version when it opens a session; a new version is a new file
(`maps/<site>/v<n>.json`). A breaking change to this document is a new map
schema version, not an edit to v0.
