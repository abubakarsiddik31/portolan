# Drift run

Switch the held-out fixtures from v1 to v2 mid-run and repair the ops that
break.

```sh
pnpm --filter @abubakarsiddiik/bench drift
```

The run:

1. runs `library.search`, `support.login`, and `support.create` against v1;
2. switches the fixtures to v2 and runs them again;
3. repairs each failure from a v2 fallback trace, verifies it, and publishes;
4. runs the repaired ops against v2.

Outputs:

- `bench/results/drift.json` — the before/after, repairs, and metrics;
- `bench/results/drift.md` — the table;
- `maps/heldout/library/v5.json`, `maps/heldout/support/v6.json`, `v7.json`.

## Result

| Op | v1 | after switch | after repair | tier |
|---|---|---|---|---|
| library.search | pass | fail | pass | url |
| support.login | pass | fail | pass | ui |
| support.create | pass | fail | pass | http |

- **Repair rate:** 100% (3/3)
- **Duplicate writes:** 0
- **Drift-day success:** 100%

## Caveats

- **The model is scripted.** This validates the drift path, the repair loop,
  and the maps; it is not a model-quality number.
- **One write.** `support.create` is the only write. The verifier runs it on
  fresh sessions with different params; no idempotency key is retried, so no
  duplicate write is possible here.
- **The library search post check is empty.** The v1 state URL moved with the
  route; the repair overrides `post` rather than inventing a new state URL.
- **Three ops, not every op.** The filter and paginate drifts are semantic
  (the op succeeds but returns the wrong rows), which needs a predicate-level
  check the drift script does not have yet.
