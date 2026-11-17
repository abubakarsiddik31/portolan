# Held-out map compile

The held-out fixtures have seed maps with the state model and the op
signatures. The compile runs a fallback trace for each op, segments it,
parameterizes it, infers returns, lifts it to the cheapest tier, verifies it
on fresh sessions, and publishes a new map version.

```sh
pnpm --filter @abubakarsiddiik/bench heldout:compile
```

Outputs:

- `maps/heldout/library/v2..v4.json`
- `maps/heldout/support/v2..v5.json`
- `bench/results/freeze.json`

The freeze record carries the commit SHA, the model, and the final version and
op list for each map.

## Result

| Site | Final version | Ops | Tiers |
|---|---:|---|---|
| library | 4 | search, get_book, borrow | url, url, ui |
| support | 5 | login, list_tickets, filter_tickets, paginate, create_ticket | ui, url, url, url, http |

`list_tickets` is a seed read op, not a compiled one: it is the
`outcome_check` for `create_ticket`. The other ops are compiled from traces.

## Model

The run uses the scripted model, because no provider key is configured here.
The freeze record says `model: "scripted"`. A real freeze would put the
provider model id in the same field; the compiler path is identical.

## Why `maps/heldout`

The dev map store reads `maps/<site>`, so the held-out maps live under
`maps/heldout/<site>` and do not appear in `list_sites` for the dev fixtures.
