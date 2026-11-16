# Build a map

A map starts as a hand-written contract, gets verified against a live site, and
is then compiled from real traces. This page is the short version; the
[build plan](https://github.com/abubakarsiddik31/portolan/blob/main/docs/BUILD_PLAN.md)
has the full pipeline.

## 1. Initialize

```bash
portolan init ./my-site --site store
```

This writes `portolan.config.json`, an egress policy at
`policies/store.json`, and the `maps/` and `skills/` directories.

## 2. Write the operations

Create `maps/store/v0.json` with states, operations, and their schemas. A
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
    { "tier": "url", "template": "/search?q={query}" }
  ]
}
```

The full field reference is [Map format v0](/reference/map-format).

## 3. Verify

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
portolan verify --map maps/store/v0.json --params store.params.json --base-url https://store.example
```

Each operation is reported per tier. A failed verification never publishes.

## 4. Compile from traces

Collect fallback traces from real runs, then compile them into a new map
version:

```bash
portolan compile run-1.json run-2.json \
  --map maps/store/v0.json \
  --base-url https://store.example \
  --outcome-checks store.outcomes.json
```

The compiler proposes candidates, verifies them, and publishes a new version.
The map is versioned: a session pins one version, so a publish never changes the
meaning of a call in flight.

## 5. Export a skill

```bash
portolan export-skills --map maps/store/v1.json --out skills --trace run-1.json
```

The exporter writes `skills/portolan-store/` with `SKILL.md` and
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
