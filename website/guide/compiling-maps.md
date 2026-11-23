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

## Coverage: the capability ledger

A crawl finds pages, not every capability. `map build` therefore writes
`capabilities.json` next to the map: every link, form, and button it saw on every
visited page, marked `mapped`, `missing`, `excluded`, or `stale`.

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
- a manual decision has `source: "manual"` and survives rediscovery;
- code-derived capabilities (`source: "code"`) cover things the crawl cannot see.

Use `--require-complete` to refuse publication while anything is `missing` or
`stale`:

```bash
portolan map build ... --require-complete --verify --publish
```

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

## Compile from traces

Collect fallback traces from real runs, then compile them into a new map
version:

```bash
portolan compile run-1.json run-2.json \
  --map .portolan/maps/store/v0.json \
  --base-url https://store.example \
  --outcome-checks store.outcomes.json
```

The compiler proposes candidates, verifies them, and publishes a new version.
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
