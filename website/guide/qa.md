# QA your app

Portolan QA turns your coding agent into the test author. Cases are JSON files
under `qa/`, reviewed in git. Runs are deterministic — no model in the run
path — with typed results, evidence, and a local SQLite history under
`.portolan/`.

The agent authors and repairs the tests; the runner replays them.

## Set up

Inside your project (the app under test):

```bash
portolan qa init --base-url http://127.0.0.1:3000
```

This writes `portolan.config.json`, the `qa/cases` and `qa/suites`
directories, `skills/portolan-qa/SKILL.md`, and `.mcp.json` when Claude Code is
detected. For any other harness it prints the MCP snippet to add to that
harness's own config. Ask the agent to read the skill, then restart the harness
so the QA tools load. `portolan qa doctor` (CLI) checks config, database, and
the browser; there is no `qa_doctor` MCP tool.

## The loop

1. After a change, call `qa_plan`. It returns the cases the diff touches
   (`touches` globs and routes) and any that are not verified.
2. Run the selection with `qa_run`. Results are typed: `fail_code` is the
   contract the agent branches on (`not_found`, `stale_ref`,
   `assertion_failed`, `value_lost`, …).
3. On a locator failure (`not_found`, `stale_ref`, `not_interactive`), call
   `qa_repair`. It replays to the failure, recovers the moved or renamed
   target by name similarity, rewrites the case as a draft, records a drift
   event, and confirms with one run.
4. Fix the app or the expectation, then rerun.

## Authoring

One case per file, `qa/cases/<id>.json`, the id matching the path:

```json
{
  "schema": 1,
  "id": "auth/login",
  "title": "Login",
  "suite": "smoke",
  "effect": "read",
  "steps": [
    { "goto": "/sign-in" },
    { "do": "fill", "target": { "role": "textbox", "name": "Email" }, "value": "${fixture.user.email}" },
    { "do": "click", "target": { "role": "button", "name": "Login" } }
  ],
  "expect": [{ "url": "/dashboard" }]
}
```

The agent can also hand `qa_generate` a loose step list (`from_spec`) or a
recorded trace file (`from_trace`). Generate fills the defaults, and replaces
secret-looking fill values with `${env.QA_*}` references — a recorded
password never lands in a case file.

Fixtures resolve at run time from `qa/fixtures.json`; secrets are env
references. Evidence is redacted before it is written.

## Trust

- A generated or repaired case is always `draft`.
- `qa_verify` replays a case N times on fresh sessions; only then is it
  `verified`, and the record lives in the database, not the JSON.
- Editing a verified case demotes it to draft. That is correct.
- `qa_run` refuses unverified cases unless told otherwise.

## Tools

| Tool | Purpose |
|---|---|
| `qa_list` | Case index with status, suite, tags |
| `qa_plan` | Cases affected by the current diff |
| `qa_run` | Execute a selection; typed per-case results |
| `qa_status` | A run's status, summary, and per-case outcomes |
| `qa_result` | One case's failure: expected vs actual, evidence paths, `next[]` |
| `qa_case_read` / `qa_case_write` | Read or write a case file |
| `qa_generate` | Normalize a spec or a recorded trace into a draft |
| `qa_verify` | Replay N times; the only path to `verified` |
| `qa_repair` | Recover a broken locator from a failed run |
| `qa_coverage` | Routes covered by cases, and the gaps |
| `qa_report` | JSON, markdown, or JUnit XML for a run |

The same surface is on the CLI as `portolan qa <command>`.

The full design — storage model, schema, runner contract, trust lifecycle —
is in [docs/QA.md](https://github.com/abubakarsiddik31/portolan/blob/main/docs/QA.md).
