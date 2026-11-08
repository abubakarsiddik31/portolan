# Arm A — the `browser-use` baseline

This is the status-quo arm for G0. It runs the same YAML tasks as the
oracle and the agent-browser backend, using `browser-use`'s own agent loop and
browser.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
cd bench/baseline
uv sync
uv run pytest
uv run python runner.py --dry-run
```

`uv sync` installs `browser-use` 0.13.14 into an isolated `.venv`. It does not
download a browser; the runner uses the system Chrome via `CHROME_PATH` or
`find_chrome_executable()`.

## Run

Start the fixtures first:

```bash
pnpm --filter @portolan/bench run fixtures:store
pnpm --filter @portolan/bench run fixtures:wizard
pnpm --filter @portolan/bench run fixtures:portal
```

Then, with provider keys in the repository `.env`:

```bash
uv run python runner.py --provider anthropic --model "$ANTHROPIC_MODEL"
uv run python runner.py --provider openai --model "$OPENAI_MODEL"
```

Useful flags:

- `--task <id>` — one task id or template id; repeatable.
- `--site store|wizard|portal` — filter by fixture.
- `--limit 1` — smoke one task.
- `--headed` — watch the browser.
- `--results <path>` — JSONL output, default `bench/results/baseline.jsonl`.

## What it records

Each row matches the TypeScript `RunResult` schema: arm `A`, provider, model,
steps, success, token usage and cost. Tokens and cost come from
`history.usage` (`total_prompt_tokens`, `total_prompt_cached_tokens`,
`total_completion_tokens`, `total_cost`).

## Known limits

- **Downloads are not checked.** `browser-use` does not expose the downloaded
  file, so the portal CSV task is recorded as a failure with a clear reason.
  The G0 report must treat that task separately.
- **Success predicates** use the live page after the run: URL and DOM clauses
  are evaluated through `BrowserSession`, not through browser-use's own judge.
- **Cost** is browser-use's usage summary. The G0 comparison should use the
  same price table for both arms; if the summaries disagree, recompute from
  tokens.
