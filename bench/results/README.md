# Results

Raw runs are JSONL, one `RunResult` per line. The table generator reads them
and writes both a compact table and the final table with confidence intervals:

```sh
pnpm results:table
# reads  bench/results/results.jsonl
# writes bench/results/table.md
#        bench/results/final-table.md
```

Arguments are `input`, `table`, `final`:

```sh
pnpm results:table bench/results/results.jsonl bench/results/table.md bench/results/final-table.md
```

## Scoring

`scoreByArm` groups runs by template first, then arm. Each template gets a
success rate, a cost per completed task, and steps per task; the arm's number
is the mean of its template numbers.

`bootstrapInterval` resamples **templates**, not runs. Runs of the same
template are correlated, so resampling runs would overstate the evidence. The
default is 2,000 resamples at 95%; the seed is fixed so a regenerated table is
byte-identical.

The final table shows the estimate and the interval:

```
| Arm | Runs | Templates | Success (95% CI) | $/completed (95% CI) | Steps/task (95% CI) |
```

A `—` in `$/completed` means no run of any template in that arm completed.

## Artifacts

| File | What it is |
|---|---|
| `compiled-dev.md` | Compiler coverage and yield on the dev fixtures |
| `pilot.jsonl`, `pilot.md` | N=1, 16 rows, arm C, scripted |
| `n3.jsonl`, `n3.md`, `n3-final-table.md` | N=3, 48 rows, arm C, scripted |
| `drift.json`, `drift.md` | v1 → v2 repair, scripted |
| `conformance.json`, `conformance.md` | Claude Code, Codex CLI, Gemini CLI |
| `freeze.json` | Held-out map versions and the frozen commit |
| `perf.json`, `perf.md` | Op latency on the store fixture |

The report that explains them is [docs/BENCHMARK.md](../../docs/BENCHMARK.md).
Every row in these files is `provider: scripted`; none is a gate result
(ADR-005).

## Raw results

`appendResult` validates every row with `runResultSchema` before appending, and
`readResults` validates every line on read. A malformed line names its line
number and refuses to produce a table.

`bench/results/results.jsonl` is not committed yet; the benchmark runs fill it.
