# QA your app

Portolan QA turns your coding agent into the test author. Cases are JSON files
under `.portolan/qa/`, reviewed in git. Runs are deterministic — no model in
the run path — with typed results, evidence, and a local SQLite history under
`.portolan/state/`.

The agent authors and repairs the tests; the runner replays them.

## Set up

Inside your project (the app under test):

```bash
portolan qa init --base-url http://127.0.0.1:3000
```

This writes `.portolan/config.json`, the `.portolan/qa/cases` and
`.portolan/qa/suites` directories, `.portolan/skills/portolan-qa/SKILL.md`,
and `.portolan/.gitignore` (which ignores `state/`). It prints the MCP snippet
for your harness and the root `.mcp.json` path; pass `--mcp` to write or merge
that file. It never modifies the root `.gitignore`. Ask the agent to read the
skill, then restart the harness so the QA tools load. `portolan qa doctor`
(CLI) checks config, database, and the browser; there is no `qa_doctor` MCP
tool.

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

One case per file, `.portolan/qa/cases/<id>.json`, the id matching the path:

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

Fixtures resolve at run time from `.portolan/qa/fixtures.json`; secrets are
env references. Evidence is redacted before it is written.

## Environments and sign-in

To test dev, QA, and prod without handing the agent a credential, name each
target in `.portolan/config.json` and sign in once per account:

```json
{
  "environments": {
    "dev":  { "baseUrl": "https://dev.app.com", "profiles": ["admin", "member"], "writes": true },
    "qa":   { "baseUrl": "https://qa.app.com",  "profiles": ["admin"], "writes": true },
    "prod": { "baseUrl": "https://app.com",     "profiles": ["readonly"] }
  }
}
```

```bash
portolan auth login --env qa --profile admin   # a person signs in, MFA included
portolan auth status                           # which profiles have a session
portolan qa run --env qa --as admin --all
```

The agent calls `qa_environments`, then `qa_run { env: "qa", as: "admin" }`. It
picks names. It never sees a password, cookie, or session path.

- **The session is saved outside the repo**, in `~/.portolan/sessions/` (or
  `$PORTOLAN_HOME`), created `0600` in a `0700` directory. Portolan does not
  store your password. `auth login --env` waits for you to press Enter, so MFA
  or an identity-provider redirect cannot be mistaken for a finished sign-in.
- **`writes` defaults to `false`.** A read-only environment skips every case
  whose `effect` is not `read`, and the browser aborts any non-GET, HEAD, or
  OPTIONS request. An app that reads over POST (GraphQL) needs `"writes": true`
  with a read-only account.
- **A run stays on its origin.** A `goto`, an op's `http` request, or an op's
  `url` navigation to another origin fails, and a `${env.QA_*}` value is only
  typed on the environment's origin. A server redirect is not blocked.
- **An expired session** fails like any broken page; the result's `next` names
  the `auth login` command for a person to run.
- `QA_BASE_URL` cannot be combined with `--env`. Unknown keys under an
  environment are errors, so a typo cannot leave prod writable.

Use dedicated test accounts, and a genuinely read-only account for prod. A saved
session is as powerful as the account it belongs to. Whoever can read the file
can replay it, so the file's location and mode are the protection, not a gate
inside Portolan. An agent with a shell as your user can read it.

Secrets in cases are `${env.QA_*}` references: only `QA_*` variables resolve,
and only in a step's `value` or `params`. Every resolved value is scrubbed from
results, evidence, and the database in raw, URL-encoded, JSON-escaped, and
base64 form, and values shorter than four characters are not scrubbed.

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
