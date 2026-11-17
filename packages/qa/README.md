# @abubakarsiddiik/qa

Local, agent-first QA for Portolan. A coding agent plugs this into its harness
through MCP or the CLI, authors test cases as JSON, runs them deterministically
against a local app, and gets typed results and evidence.

- Cases and suites are files under `qa/`, reviewed in git.
- Run history, evidence, flakes, and verification records live in a local
  SQLite database under `.portolan/`.
- `status` is database-derived: a file cannot claim `verified`; only
  `qa verify` can record it.
- No model is called in the run path. The caller's agent generates and repairs;
  the runner replays.

## Install into a harness

```sh
npx -y -p @abubakarsiddiik/qa portolan-qa   # stdio MCP server
# or, from a checkout:
portolan qa init
portolan qa plan --changed
portolan qa run --changed
```

## MCP tools

`qa_list`, `qa_plan`, `qa_run`, `qa_status`, `qa_result`, `qa_case_read`,
`qa_case_write`, `qa_verify`, `qa_coverage`, `qa_report`.

`qa_generate` and `qa_repair` are planned; author cases with `qa_case_write`
and promote them with `qa_verify`.

See [docs/QA.md](../../docs/QA.md) for the design and trust model.
