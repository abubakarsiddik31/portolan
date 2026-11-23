# Build a map

A map is learned, not hand-written. Portolan discovers what a site can do, turns
each finding into a candidate op, and publishes only the ops that pass on a live
run. No OpenAPI file or hand-authored JSON is required.

## Start from the live app

```bash
portolan map build --site herbie \
  --url http://localhost:3000 \
  --start "npm run dev" \
  --verify --publish
```

Portolan opens the app in Chromium (the same DOM and CDP surface DevTools uses),
walks same-origin pages, and turns what it finds into drafts:

- every page becomes a URL-only state like `/p/:id`;
- every navigation link becomes a `url` read op;
- every form becomes a typed op: inputs become params, the submit button becomes
  a `ui` step, and a GET form also gets the cheaper `url` route.

Discovery never submits a form. Writes publish only when re-verified with
`--verify-writes` or proven by a recorded run.

The command writes two reviewable files next to the map versions:

```text
maps/herbie/
  draft.json    candidate ops, provenance, and observed params
  tasks.json    what discovery could not know (missing params, outcome checks)
  v1.json       published, verified ops
```

### Pages behind auth

Sign in once in a visible browser and reuse that session. Portolan never sees
the password:

```bash
portolan auth login --url https://careerkor.com/sign-in \
  --out ./.portolan/state/auth.json

portolan map build --site careerkor \
  --url https://careerkor.com/dashboard \
  --storage-state ./.portolan/state/auth.json \
  --verify --publish
```

The same file works for `portolan verify`, `portolan compile`, and the MCP
runtime (`PORTOLAN_STORAGE_STATE` or `storageState` in the config). A different
account or an expired session means a new file.

## Update the map when the app changes

```bash
portolan map update --site herbie --url http://localhost:3000 --verify --publish
```

An update keeps ops that rediscovery did not see, replaces ops it did see after
verification passes, and publishes a new version. A session pins a version, so an
update never changes the meaning of an in-flight call.

If the app has no link or form to start from, record one run instead:

```text
open_url(url, intent)   → explore session + fallback scope
view() / act() / read()  → the task, recorded
fallback_done(scope_id)  → saves the trace
```

Then `portolan map build --site herbie` compiles the trace into candidates.

## Reaching routes a link does not

Discovery follows links. A single-page app often navigates with buttons, list rows, and
workspace switchers, so pages behind them never get crawled. Three flags close the gap:

```bash
portolan map build --site app \
  --url http://localhost:5173/admin --url http://localhost:5173/app \
  --routes-from react-router --src ./src \
  --explore --verify --publish
```

- Repeat `--url` to crawl several entry points in one discovery, so a page is not marked
  `removed` only because another entry point did not reach it.
- `--routes <file>` (one path per line, or a JSON array) and `--routes-from
  react-router|next|sveltekit` list the routes the app has. Routes without parameters are
  crawled directly; at the end `N routes not reached: ...` lists the ones no page matched.
  The react-router reader finds `path="..."` and `path: "..."` strings, so a nested
  relative path is read as written.
- `--explore` clicks buttons during discovery, only ones no policy rule matches (the
  shipped rules and `policies/<site>.json`, plus `--exclude`), never one inside a form, and
  reloads the page after each click. A click that lands on a new route is queued and
  recorded as a `go_<button>` op.

## Record the gaps without an agent loop

Most gaps after a crawl are one click on a named control. `map record --gaps` records
them without a model turn per gap:

```bash
portolan map record --gaps --site app --base-url http://localhost:5173 \
  --storage-state auth.json --max 50
portolan map build --site app --verify --publish
```

For each `missing` button it opens the page (a parameterized state is filled from the
sample params discovery saw, or from `--params`), clicks the control by role and name,
and writes a trace tagged with the capability id, so the next build covers exactly that
capability. The summary counts `recorded`, `navigated_away`, `disabled`, `not_found`,
`skipped`, and `failed`. A control that is not found lists the buttons and links the page
does have; a disabled one becomes `unavailable`. Add `--kind button,link`, `--only
<id,...>`, or `--max N` to narrow it.

A control that matches a destructive, cost, billing, or session rule, or whose name reads
like a write (save, create, send, upload), is skipped unless you pass `--writes`.

An agent recording over MCP can pass `capability` to `open_url` or `fallback_begin` for
the same link.

## What "verified" proves

A `ui` op that only clicks verifies as soon as the locator resolves, so a filter that
does nothing would pass. When `map build` compiles a recorded run it proposes the
postconditions the run showed, and `draft.json` lists them under the op's notes:

- the URL changed: a new path, or a query such as `?range=30d` (`url` with `search`);
- the page moved to a state the map names (`state`);
- a dialog, menu, or alert appeared (`exists`).

Verification then enforces them. A `ui` op with no postcondition gets an
`add_postcondition` task; `--require-post` refuses to verify it, and `"no_post": true`
on the op says the empty list is on purpose. `--no-infer-post` skips the proposals.
Text that changed and the effect of a write are not inferred: a phrase varies between
runs, and a write needs an outcome check.

## Verification speed

`map build --verify` runs each op in its own browser context inside one shared Chrome.

- Identical param sets run once, and an op with no required params needs one run, not three.
- Reads run side by side (`--concurrency 4` by default). A write always runs alone.
- Ops that verified against the same app build are skipped. The build is `--app-version <v>`,
  or a hash of the HTML served at the base URL, and the record is `verified.json` next to the
  map. `--reverify` runs them again.

## Coverage: the capability ledger

A crawl finds pages, not every capability. `map build` therefore writes
`capabilities.json` next to the map: every link, form, and button it saw on every
visited page, marked `mapped`, `missing`, `excluded`, `unavailable`, `stale`, or
`removed`.

```bash
portolan map coverage --site careerkor --maps ./.portolan/maps
# careerkor: 27 mapped, 48 missing, 51 excluded, 0 stale (36% of actionable)

portolan map capability set --site careerkor --maps ./.portolan/maps \
  --id pricing.button.choose_pro --status excluded --reason "requires a paid plan"
```

The ledger is the reviewable contract:

- `mapped` only when a verified op covers that exact trigger;
- `missing` is the work queue;
- `excluded` requires a reason (destructive, credit-spending, obsolete);
- `unavailable` is a control that was disabled everywhere the crawl saw it; it is not
  work to record, and `--strict` makes `--require-complete` count it;
- `removed` means a crawl reached the page and the control was gone; `stale` means
  an op that used to verify now fails. Both carry `stale_since`. A crawl only judges
  the pages it reached: everything else keeps its status, `last_seen`, and
  `last_verified`;
- a layout control in a landmark (`banner`, `navigation`, `complementary`) that
  appears on three or more pages is one capability with `pages: [...]`, not one per
  page; its op is verified on the page it was recorded on and then valid from all of
  them. `--no-dedupe` keeps one entry per page;
- a name with data in it is a template: `Active 1` is `Active {count}` and
  `Delete a@x.com` is `Delete {email}`, so one entry covers every row. A leading
  number (`30 days`) is a label and stays;
- a manual decision has `source: "manual"` and survives rediscovery;
- code-derived capabilities (`source: "code"`) cover things the crawl cannot see.

Use `--require-complete` to refuse publication while anything is `missing`,
`stale`, or `removed`:

```bash
portolan map build ... --require-complete --verify --publish
```

After a change to one page, re-check only it, and find what nothing has looked at
lately:

```bash
portolan map update --site careerkor --state pricing --verify --publish
portolan map coverage --site careerkor --older-than 7d
```

A parameterized state such as `org_detail` (`/orgs/:id`) needs a param set for the
op that opens it in `--params`.

`portolan init` installs `.portolan/skills/portolan-map/SKILL.md`, the companion skill that
tells a coding agent how to work the ledger until it is complete.

## Optional: hand-written seed

For a precise contract you can still write `.portolan/maps/<site>/v0.json` by hand and
verify it:

### Initialize

```bash
portolan init ./my-site --site store
```

This writes `.portolan/config.json`, an egress policy at
`policies/store.json`, and the `maps/` and `skills/` directories.

### Write the operations

Create `.portolan/maps/store/v0.json` with states, operations, and their schemas. A
minimal operation:

```json
{
  "name": "search",
  "effect": "read",
  "params": {
    "type": "object",
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  },
  "returns": {
    "type": "object",
    "properties": { "results": { "type": "array" } }
  },
  "impls": [
    { "tier": "url", "route": "/search?q={query}", "extract": { "kind": "none" } }
  ]
}
```

The full field reference is [Map format v0](/reference/map-format).

### Verify

Verification runs each operation against a live site on a fresh session. Every
operation needs at least three param sets:

```json
{
  "search": [
    { "query": "shirt" },
    { "query": "linen" },
    { "query": "coat" }
  ]
}
```

```bash
portolan verify --map .portolan/maps/store/v0.json --params store.params.json --base-url https://store.example
```

Each operation is reported per tier. A failed verification never publishes.

Verification waits for each page to settle before it reads a state or resolves
a locator. On a client-rendered app the DOM is still empty at
`domcontentloaded`; a `ui` step that misses re-settles and retries against a
fresh capture, so a control that React, Vue, or Svelte renders after the
initial document is not reported as a broken locator.

## Compile from traces

Collect fallback traces from real runs, then compile them into a new map
version:

```bash
portolan compile run-1.json run-2.json \
  --map .portolan/maps/store/v0.json \
  --base-url https://store.example \
  --params store.params.json \
  --outcome-checks store.outcomes.json
```

The compiler proposes candidates, verifies them, and publishes only the ones that
pass, as a new version. A step the map does not cover is named from what was
recorded: a write is named after the click that sent the request.

Reads are verified with the values from the recording plus synthetic variants. A
write changes data, so it runs only with `--verify-writes` and a `--params` file
holding at least three parameter sets for it:

```json
{ "create_api_key": [{ "name": "a" }, { "name": "b" }, { "name": "c" }] }
```

`--outcome-checks` maps a write to the read op that proves it took effect:

```json
{ "create_api_key": "list_api_keys" }
```

With one, a recorded write compiles to an `http` op. Without one it compiles to a
`ui` op that replays the clicks. `map build` takes the same `--outcome-checks`,
`--params`, and `--verify-writes` flags.

The map is versioned: a session pins one version, so a publish never changes the
meaning of a call in flight.

## Export a skill

```bash
portolan export-skills --map .portolan/maps/store/v1.json --trace run-1.json
```

The exporter writes `.portolan/skills/portolan-store/` with `SKILL.md` and
`references/ops.md`. It refuses to write an invalid skill or one that looks like
it contains a secret. See [Skills](/guide/skills).

## The loop

```text
hand-written ops → verify → trace real runs → compile → verify → publish
                                      ▲                         │
                                      └──── repair on drift ◀───┘
```

When a site changes, a drift run reports what broke. Repair proposes new
implementations, verifies them, and publishes a new version. Writes are never
duplicated: the ledger records the outcome before the next attempt.
