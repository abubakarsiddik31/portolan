# Op latency

Measures the runtime, not the CLI: `runUrlOp`, `runHttpOp`, and `runUiOp`
against the store fixture on a local Chrome.

```bash
pnpm --filter @portolan/bench perf
```

Writes `bench/results/perf.json` and `perf.md`. `PERF_RUNS` overrides the
sample count (default 10).

Budgets (p50): `ui` ≤500ms, `url` and `http` ≤150ms. `perf.test.ts` asserts
them and is skipped in CI unless `PORTOLAN_BROWSER_TESTS=1`.

The `ui` op is `add_to_cart`, which includes a real navigation to `/cart`. The
engine waits for `domcontentloaded` and the requests it captured, not
Playwright's `networkidle` (which is 500ms of quiet by definition).
