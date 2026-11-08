# N=3

Sixteen held-out templates, three param sets each, through the shared runner.

```sh
pnpm --filter @portolan/bench n3
```

Outputs:

- `bench/results/n3.jsonl` — 48 scored rows;
- `bench/results/n3-table.md` — the compact table;
- `bench/results/n3-final-table.md` — the template-bootstrap CIs;
- `bench/results/n3.md` — the report and coverage gaps.

## What ran

Arm C (the substrate backend) with the deterministic scripted model. The
result is 100% success and $0 cost by construction; this validates the frozen
maps, the runner, the backend, and the result schema, not model quality.

## What did not run

| Arm / run | Why |
|---|---|
| A (browser-use) | needs `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| B (agent-browser) | only the store harness test exists |
| D-oracle | the held-out maps exist, but the MCP server's op executor is not wired for them |
| provider Y transfer | no second provider is configured |

The criterion "all arms × 2 providers + transfer runs" is not met. The raw
rows that could be produced are committed; the report says what is missing.

## Tests

`n3.test.ts` reads the committed raw rows and asserts 48 rows, 3 per template,
arm C, scripted, all successful, and that the final table regenerates.
