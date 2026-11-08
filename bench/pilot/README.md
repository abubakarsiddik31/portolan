# Pilot N=1

One param set per held-out template, one run each, through the shared runner.

```sh
pnpm --filter @portolan/bench pilot
```

The script writes:

- `bench/results/pilot.jsonl` — 16 scored rows, arm C;
- `bench/results/pilot-table.md` — the compact table;
- `bench/results/pilot-final-table.md` — the template-bootstrap CIs;
- `bench/results/pilot.md` — the report, including the arms that did not run.

## What this pilot is

A **harness check**, not a model benchmark. The model is the deterministic
scripted model, so the success rate is 100% and the cost is zero. It proves
that every held-out template produces a valid `RunResult`, that the backend
and checker agree, and that the table regenerates from the raw rows.

## Arms

| Arm | Status |
|---|---|
| A (browser-use) | blocked on `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| B (agent-browser) | harness test covers one store task; not in this pilot |
| C (substrate) | 16 rows, all templates |
| D-oracle | the held-out fixtures have no oracle maps yet |

A real N=1 needs provider keys and a local model. The harness is ready for
that run; this pilot is what can be verified without them.

## Tests

`pilot.test.ts` runs the same 16 templates through arm C in CI and asserts
that every one produces a scored row and that the final table contains
`| C | 16 | 16 |`.
