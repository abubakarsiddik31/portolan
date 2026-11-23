# Portolan QA — local, agent-first test generation and management

| | |
|---|---|
| **Status** | Shipped in `@abubakarsiddiik/qa` 0.1.1+ (M1 and M2). M3 is not started. |
| **Date** | 2026-11-16 |
| **Scope** | The QA vertical (candidate D in [VERTICALS.md](./VERTICALS.md)) as a local tool an agent drives from its coding harness. |
| **Non-goal** | A test-management web app, hosting, scheduling, RBAC, or a TestRail/Xray/Zephyr clone. |
| **Read first** | ADR-002 (map runtime), ADR-003 (MCP executes, Skills teach), ADR-009 (G0 first), [qa/careerkor/improvements.md](./qa/careerkor/improvements.md) item 6 |

## 1. The bet

A developer installs one tool, points it at their running app, and their coding
agent uses it to generate, verify, run, and repair end-to-end tests. The agent
is the primary user. The human reviews a git diff and a short run summary.

The tool is local, deterministic where it matters, and repo-native. Its output
is typed data an agent can branch on, not a dashboard a human must interpret.

This is also the on-ramp for the map runtime: a verified QA case is a map op
plus assertions, so every QA user produces the first maps for their own app.

## 2. What "agent-first" removes and adds

**Removed:** web UI, case editor, drag-and-drop, dashboards, accounts, tenant
model, hosted scheduler, human approval workflow, email/Slack notifications.

**Added:** a small MCP tool surface with typed results, a `SKILL.md`, JSON/YAML
artifacts in git, bounded token budgets, evidence by path, and server-enforced
trust gates.

**Design rules**

1. Artifacts are the API. Cases, suites, runs, and evidence are files.
2. Typed over prose. Every failure carries `code`, `fail_reason`, and `next[]`.
3. Token budget. No inline screenshots or DOM; summaries are capped and paged.
4. Deterministic runs. No LLM in the execution path. The caller's agent
   generates; the runner replays.
5. Idempotent and resumable. A run has an id, an event log, and partial evidence.
6. Server-enforced trust. Nothing is `verified` without N fresh-session replays.
7. Discoverable. The tool list and skill are enough; no external docs needed.
8. Local by default. Loopback only, no account, no telemetry, offline-capable.

## 3. Architecture

```
coding harness (Claude Code / Codex / Cursor / opencode / Gemini CLI)
        │  MCP (qa_* tools)          or          CLI (portolan qa ...)
        ▼                                        ▼
┌───────────────────────────────────────────────────────────────┐
│ @abubakarsiddiik/qa                                                  │
│                                                               │
│  spec/     case + suite schema (zod), file IO, validation      │
│  plan/     git-diff → affected cases (touches globs, routes)   │
│  runner/   steps → Substrate, assertions, retries, evidence    │
│  verify/   N fresh-context replays → draft | verified          │
│  repair/   stale locator recovery from a failed run            │
│  report/   JSON, JUnit XML, markdown summary                   │
│  store/    SQLite index + run history + evidence + flakes      │
│  mcp/      qa_* tools over stdio                               │
└───────────────────────────────────────────────────────────────┘
        │
        ├── @abubakarsiddiik/substrate  (Playwright/Chromium, refs, settle)
        ├── @abubakarsiddiik/runtime    (checks, traces, redaction)
        ├── @abubakarsiddiik/protocol   (Locator, PostCheck, map types)
        └── better-sqlite3       (local database)
```

`@abubakarsiddiik/qa` does not depend on `@abubakarsiddiik/server`. It owns its MCP server so
the harness sees only QA tools; the site-map MCP tools stay separate and small.

## 4. Storage model: files are canonical, SQLite is the product store

There are two kinds of state, and they have different shapes:

- **Specs** (suites, cases) are reviewed in pull requests. They are canonical
  files, one case per file, so an agent edit is a small diff and a conflict is
  rare.
- **History** (runs, results, evidence, flakes, drift, coverage) is append-only
  and never reviewed as source. It lives in a local SQLite database.

The database is a derived index over specs plus the system of record for
history. It is rebuildable from files for the spec half, and it is the only copy
of the history half. This avoids the worst dual-write failure (two editable
copies of a case) while satisfying the requirement for a real local database.

**Invariants**

1. A case or suite is edited only through its file; `qa_case_write` writes the
   file first, then reindexes the row. File and index are two operations, so a
   crash between them is a reconciliation, not a transaction.
2. `status` is **DB-derived**. A file's `status` is informational except for
   `disabled`; `qa sync` imports any other case as `draft`. A case is
   `verified` only when the DB holds a `verified_sha` equal to the content
   hash produced by `qa verify` (or `qa_verify` over MCP). Editing the JSON
   cannot forge trust.
3. Every indexed spec row stores `spec_sha`; a mismatch is reported by
   `qa doctor` and repaired by `qa sync`.
4. Deleting a case file marks the row `orphaned`; history is never deleted
   implicitly.
5. The DB is safe to delete: specs survive, history and verification records
   are lost, and every case returns to `draft` until verified again. That is
   the honest failure mode for a fresh clone.

### 4.1 Schema (SQLite, WAL, foreign keys on)

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- schema_version
-- PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;

CREATE TABLE suites (
  name        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  spec_json   TEXT NOT NULL,
  spec_sha    TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE cases (
  id           TEXT PRIMARY KEY,
  suite        TEXT NOT NULL REFERENCES suites(name) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN
                 ('draft','verified','broken','quarantined','disabled','orphaned')),
  effect       TEXT NOT NULL CHECK (effect IN ('read','write','irreversible')),
  tags_json    TEXT NOT NULL DEFAULT '[]',
  touches_json TEXT NOT NULL DEFAULT '[]',
  routes_json  TEXT NOT NULL DEFAULT '[]',
  source_json  TEXT,
  spec_json    TEXT NOT NULL,
  spec_sha     TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  verified_at  TEXT,
  verified_sha TEXT,               -- content hash recorded by qa verify; the trust gate
  verify_runs  INTEGER NOT NULL DEFAULT 0,
  map_site     TEXT,
  map_version  INTEGER,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX cases_suite  ON cases (suite);
CREATE INDEX cases_status ON cases (status);

-- Revisions live in git, not in a second spec copy. `cases.revision` is a
-- counter only; history is `git log .portolan/qa/cases/<id>.json`.

CREATE TABLE runs (
  id             TEXT PRIMARY KEY,
  commit_sha     TEXT,
  branch         TEXT,
  base_url       TEXT NOT NULL,
  trigger        TEXT NOT NULL, -- manual | changed | verify | ci | mcp
  status         TEXT NOT NULL, -- running | passed | failed | error | cancelled
  selection_json TEXT NOT NULL DEFAULT '{}',
  config_json    TEXT NOT NULL DEFAULT '{}',
  started_at     TEXT NOT NULL,
  finished_at    TEXT
);
CREATE INDEX runs_started ON runs (started_at);

CREATE TABLE run_cases (
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id      TEXT NOT NULL,
  status       TEXT NOT NULL, -- pass | fail | skip | error
  attempt      INTEGER NOT NULL DEFAULT 1,
  duration_ms  INTEGER,
  fail_code    TEXT,
  fail_reason  TEXT,
  fail_step    INTEGER,
  expected_json TEXT,
  actual_json   TEXT,
  evidence_dir TEXT,
  PRIMARY KEY (run_id, case_id, attempt)
);

CREATE TABLE evidence (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id    TEXT NOT NULL,
  kind       TEXT NOT NULL, -- view | screenshot | trace | junit | log
  path       TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX evidence_run ON evidence (run_id, case_id);

CREATE TABLE drift_events (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  run_id      TEXT,
  kind        TEXT NOT NULL, -- selector | route | semantic | network
  detail_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE flakes (
  case_id              TEXT PRIMARY KEY,
  runs                 INTEGER NOT NULL DEFAULT 0,
  failures             INTEGER NOT NULL DEFAULT 0,
  last_failure_at      TEXT,
  last_pass_at         TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  quarantine           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE coverage (
  snapshot_id  TEXT NOT NULL,
  kind         TEXT NOT NULL, -- route | state | op | feature
  key          TEXT NOT NULL,
  covered_by_json TEXT NOT NULL DEFAULT '[]',
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, kind, key)
);
```

### 4.2 DB API

```ts
class QaStore {
  static open(path: string): QaStore;        // migrate, WAL, foreign_keys
  close(): void;
  schemaVersion(): number;
  integrity(): { ok: boolean; specDrift: string[] };

  syncSpecs(root: string): SyncReport;       // files → index, mark orphaned
  putCase(spec: QaCase, filePath: string, note?: string): CaseRow;
  listCases(filter: CaseFilter): CaseRow[];
  getCase(id: string): { spec: QaCase; row: CaseRow } | undefined;

  startRun(input: StartRun): RunRow;
  finishRun(runId: string, status: RunStatus): void;
  recordCase(runId: string, result: CaseResult): void;
  addEvidence(runId: string, caseId: string, kind: string, path: string): EvidenceRow;
  listRuns(limit: number): RunRow[];
  getRun(runId: string): RunReport | undefined;

  recordFlake(caseId: string, passed: boolean): void;
  recordDrift(caseId: string, kind: string, detail: unknown, runId?: string): void;
  putCoverage(snapshotId: string, entries: CoverageEntry[]): void;
  coverageGaps(snapshotId: string): CoverageEntry[];
}
```

## 5. Case spec

One case per file: `.portolan/qa/cases/<id>.json`. The id is stable and namespaced
(`auth/login`), and the file path must match it.

```ts
type QaCase = {
  schema: 1;
  id: string;                       // "auth/login"
  title: string;
  suite: string;                    // "smoke"
  effect: "read" | "write" | "irreversible";
  status: "draft" | "verified" | "broken" | "disabled";
  tags?: string[];
  touches?: string[];               // globs, e.g. "src/auth/**"
  routes?: string[];                // "/sign-in"
  map?: { site: string; version: number; op: string };
  setup?: Step[];                   // run before steps, same session
  steps: Step[];
  expect?: Check[];
  fixtures?: string[];              // named fixtures resolved at run time
  source?: { kind: "manual" | "trace" | "generated"; trace_id?: string; commit?: string };
  notes?: string;
};

type Step =
  | { op: string; params?: Record<string, unknown>; confirm?: boolean } // map op
  | { goto: string }                                                    // baseUrl + path
  | { do: "click" | "check" | "uncheck"; target: Locator }
  | { do: "fill" | "select"; target: Locator; value: string }
  | { do: "press"; key: string }
  | { await: "url"; pattern: string; timeout_ms?: number }
  | { await: "text"; contains: string; timeout_ms?: number };

type Check =
  | { url: string }                                   // regex on location
  | { text: { contains: string } }                    // page text contains
  | { visible: Locator }
  | { absent: Locator }
  | { value: { target: Locator; equals: string } }
  | { map_post: { op: string; params?: Record<string, unknown> } }; // reuse op post
```

Values may use `${fixture.<name>}` and `${env.QA_<NAME>}` placeholders. Only
`QA_*` variables resolve, and only in a step's `value` or `params`; a `goto`,
`contains`, or `pattern` rejects them, because a secret in a URL leaves the
machine. Every resolved value is recorded for the attempt and scrubbed from the
result, events, evidence files, and DB rows in raw, URL-encoded, JSON-escaped,
and base64 form (values under four characters are not scrubbed).

### 5.1 Suite spec

`.portolan/qa/suites/<name>.json` is a selection, not a copy of the cases:

```ts
type QaSuite = {
  schema: 1;
  name: string;                     // "smoke"
  title: string;
  include: { tags?: string[]; ids?: string[]; globs?: string[] };
  exclude?: { tags?: string[]; ids?: string[] };
  continue_on_failure?: boolean;    // default true
  repeat?: number;                  // default from config
};
```

## 6. Running

### 6.1 Runner contract

```ts
type RunOptions = {
  baseUrl: string;
  cases: QaCase[];
  /** Ids the DB currently trusts as verified; the only trust input. */
  trusted: string[];
  repeat?: number;                  // flake detection, default 1
  headless?: boolean;
  executablePath?: string;
  timeoutMs?: number;
  evidence?: "failures" | "all" | "none";
  commit?: string;
  branch?: string;
  trigger: RunTrigger;
};

type CaseResult = {
  case_id: string;
  status: "pass" | "fail" | "skip" | "error";
  attempt: number;
  duration_ms: number;
  fail_code?: string;               // typed, agent branches on this
  fail_reason?: string;
  fail_step?: number;
  expected?: unknown;
  actual?: unknown;
  evidence_dir?: string;
  next?: string[];                  // e.g. ["qa repair auth/login", "inspect evidence/..."]
};
```

`fail_code` is the contract. Initial set: `not_found`, `not_interactive`,
`stale_ref`, `timeout`, `navigation`, `assertion_failed`, `precondition_failed`,
`op_failed`, `unknown_outcome`, `fixture_missing`, `harness_error`.

### 6.2 Steps

- UI steps resolve a `Locator` against the current snapshot, then call
  `Substrate.act` with the matched ref. Resolution honors `ctx` (landmark
  context) when present; it is not ignored. On `stale_ref`, re-view and
  re-resolve once. On `not_interactive`, re-view after settle and retry once.
- A `fill` is read back immediately. On a mismatch the runner clicks to focus,
  fills once more, reads again, and fails with `value_lost` if the value still
  did not stick. A success that silently lost the value is the worst QA bug;
  it must never report pass.
- `goto` calls `Substrate.goto(new URL(path, baseUrl))`.
- `op` steps require `case.map` (and a loaded map). The runner executes the op
  through the runtime tiers and asserts the op's `post` checks.
- `await` steps poll `view`/`state` until the pattern matches or the budget
  expires.
- Every step is recorded as a run event with duration, the resolved locator,
  and the typed action result.

### 6.3 Assertions

Checks are evaluated against the final snapshot, page text, and URL. `map_post`
reuses the op's `post` checks. A failed check reports `expected` and `actual`
verbatim, never a prose guess.

### 6.4 Evidence

On failure (default) or on every run (`--evidence all`):

- `view.txt` — the compact affordance view at the failure point
- `events.jsonl` — the typed steps, durations, and codes (no raw fill values)
- `result.json` — the `CaseResult`, redacted and capped
- `page.png` — optional, only when `screenshot: true`; off by default because a
  screenshot cannot be redacted

Evidence is redacted before it is written, and the DB copy of `expected` and
`actual` is redacted and truncated (2 KB) before insert. Secrets never appear
in run history.

Evidence lives under `.portolan/state/qa/runs/<run_id>/<case_id>/`. It is gitignored.
The DB stores the path, size, and SHA-256, not the bytes.

### 6.5 Determinism and flakiness

- One fresh browser context per case attempt.
- `repeat` > 1 marks a case `flaky` when outcomes differ; a flaky case is
  reported, not silently passed.
- Configurable retries are explicit (`repeat`), not hidden.
- Quarantine: a case that flaked or failed `N` consecutive runs is marked
  `quarantined` in `flakes` and skipped by `qa run --changed` until
  `qa verify` clears it.

## 7. Planning affected cases

`qa plan --changed` is the loop that makes the tool useful inside a coding
harness.

1. Determine the diff: `git diff --name-only <base>...HEAD` plus working-tree
   changes.
2. Match changed paths against each case's `touches` globs and `routes`.
3. Always include cases tagged `smoke` unless `--no-smoke`.
4. Exclude `disabled`, `orphaned`, and `quarantined` unless `--include` says so.
5. Cap the result (`--max N`, default 50) and report what was omitted.

If the diff is empty, `--changed` selects nothing and prints why. It never
silently runs the full suite.

## 8. Trust lifecycle

```
file says anything ──sync──▶ draft (unless DB has verified_sha for this hash)
draft ──qa verify (N fresh replays, all pass)──▶ verified (DB record)
  ▲                                                  │
  │                                                  ├─ run fails ──▶ broken
  │                                                  │                  │
  └──────────── repair + re-verify ◀─────────────────┘                  │
                                                                        ▼
                                                                   quarantined
```

- A file's `status` is not trust. `qa sync` imports a case as `draft` unless
  the DB already holds a `verified_sha` matching the file's content hash.
- `qa_verify` is the only path to `verified`; it requires at least
  `verify.repeat` (default 3) fresh-context passes and writes the DB record.
- `qa_run` refuses to run unverified cases unless `allow_unverified: true`;
  the refusal lists them.
- Editing a verified case changes its content hash; the next sync demotes it
  to `draft`.
- `qa repair` may edit a case, but the result is `draft` until re-verified.

## 9. Agent surface

### 9.1 MCP tools (`portolan qa mcp`)

| Tool | Purpose |
|---|---|
| `qa_list` | Case index; filters: suite, tag, status; capped |
| `qa_plan` | Cases affected by a diff; returns ids + reasons |
| `qa_run` | Execute a selection; returns `run_id` and summary. Runs are synchronous; async start + `qa_cancel` is future work. |
| `qa_status` | A run's status, summary, and per-case outcomes |
| `qa_result` | One case's typed result, evidence paths, `next[]` |
| `qa_case_read` | One case spec + status |
| `qa_case_write` | Validate and write a case file; returns diff summary |
| `qa_generate` | Normalize an agent-authored step list or a recorded trace into a draft |
| `qa_verify` | Replay N times and promote or reject |
| `qa_repair` | Attempt locator recovery from a failed run; rewrites the case as a draft, records a drift event, and confirms with one run |
| `qa_coverage` | Routes/states/ops covered and gaps |
| `qa_report` | JSON/JUnit/markdown for a run |

All results use the existing envelope: `{ ok, result | error, next? }`.
`error.code` is the agent's branch key. Page text is labeled untrusted.
`qa doctor` and `qa sync` are CLI-only; there is no `qa_doctor` MCP tool.

### 9.2 CLI

```
portolan qa init [--dir DIR] [--base-url URL] [--mcp] [--force] [--json]
portolan qa list [--suite S] [--tag T] [--status S] [--json]
portolan qa plan [--changed] [--base REF] [--max N] [--json]
portolan qa run [--changed|--suite S|--case ID...|--tag T] [--repeat N] [--json]
                 [--reporter json|junit|md] [--out PATH] [--allow-unverified]
portolan qa result <run_id> [--case ID] [--json]
portolan qa case read <id> [--json]
portolan qa case write <file> [--json]
portolan qa generate (--from-trace PATH | --spec FILE) [--id ID] [--suite S]
                     [--title T] [--map site/version/op]
portolan qa verify [--suite S|--case ID...] [--repeat N]
portolan qa repair <case_id> [--from-run RUN]
portolan qa coverage [--json]
portolan qa report <run_id> [--format md|json|junit] [--out PATH]
portolan qa sync
portolan qa doctor [--json]
portolan qa mcp
```

Exit codes: `0` pass, `1` test failure, `2` usage/config error, `3` harness
error (browser missing, app unreachable).

### 9.3 Harness init

`portolan qa init` is the only onboarding step. Everything it writes lives
under `.portolan/`:

- Writes the `qa` block into `.portolan/config.json` (or merges into an
  existing one).
- Creates `.portolan/qa/cases/` and `.portolan/qa/suites/`; both are
  committed and reviewed.
- Installs the `portolan-qa` skill into
  `.portolan/skills/portolan-qa/SKILL.md`.
- Writes `.portolan/.gitignore` with `state/`, so run artifacts, traces,
  databases, and the auth storage state stay out of git. It never touches the
  root `.gitignore`.
- Prints the MCP snippet and the root `.mcp.json` path. It only writes or
  merges that file with `--mcp`; an existing `.mcp.json` keeps its other
  entries. The snippet passes absolute `.portolan/` paths, so the server does
  not depend on the directory it was spawned in.
- Does not modify `package.json`.
- Does not run `qa doctor`; run it yourself after wiring the harness.

A legacy root layout (`portolan.config.json`, `qa/`, `maps/`, `skills/`, …)
still loads with a one-line deprecation notice. `portolan migrate` moves it
into `.portolan/` and moves the QA database with the cases, so verified cases
stay verified.

### 9.4 Skill

`portolan-qa` teaches the loop, not the syntax:

1. After editing, call `qa_plan`, then `qa_run` the affected cases.
2. On failure, read `qa_result`; branch on `fail_code`; fix the app or repair
   the case; rerun.
3. For a new feature, author steps, `qa_case_write`, then `qa_verify`; never
   commit unverified cases.
4. Never retry a write with `unknown_outcome`.
5. Do not run the full suite unless asked.

## 10. Configuration

`.portolan/config.json` gains a `qa` block; `DefaultQaConfig` supplies the rest.

```json
{
  "qa": {
    "baseUrl": "http://127.0.0.1:3000",
    "database": ".portolan/state/qa.db",
    "cases": ".portolan/qa/cases",
    "suites": ".portolan/qa/suites",
    "runs": ".portolan/state/qa/runs",
    "baseRef": "origin/main",
    "repeat": 1,
    "verifyRepeat": 3,
    "timeoutMs": 15000,
    "headless": true,
    "evidence": "failures",
    "maxCases": 50,
    "fixtures": ".portolan/qa/fixtures.json",
    "maps": ".portolan/maps",
    "screenshot": false,
    "redact": ["password", "token", "secret", "authorization", "cookie"]
  }
}
```

Credentials are references (`${env.QA_PASSWORD}`), resolved at execution and
never persisted. `QA_BASE_URL` overrides `baseUrl` and `QA_DATABASE` overrides
`database`, which lets a harness point at a preview deployment or a disposable
database without editing config.

### 10.1 Environments and sessions

A top-level `environments` block names the targets an agent may run against.
Each has `baseUrl`, `profiles`, an optional `loginUrl`, and `writes` (default
`false`). The block is parsed strictly: an unknown key or a non-boolean `writes`
is an error.

`qa_run`, `qa_verify`, and `qa_repair` (and `portolan qa run|verify|repair`)
take `env` and `as`. The runner resolves them to the profile's saved Playwright
storage state under `$PORTOLAN_HOME` (default `~/.portolan`), outside the
repository, written `0600` by `portolan auth login --env NAME --profile P`.
There is no fallback to the global `auth.json`, and `QA_BASE_URL` is refused
with `--env`.

Enforcement, in the runner and engine rather than in the agent-authored case:

- a run in a read-only environment skips cases whose `effect` is not `read`, and
  the browser context aborts every request that is not GET, HEAD, or OPTIONS;
- a `goto` off the environment origin fails with `precondition_failed`;
- an `${env.QA_*}` value is resolved only while the page is on that origin;
- a missing session is `auth_missing` with the sign-in command in `details.next`.

Not built yet: keychain-backed `${secret.*}` for scripted sign-in, automatic
session refresh, and an `auth_expired` probe. Today an expired session is a
person re-running `auth login`.

## 11. Milestones

### M1 — vertical slice (shipped in 0.1.0)

- `@abubakarsiddiik/qa`: config, case/suite schema, file IO, SQLite store with
  migrations, sync, runner (goto + UI steps + map op steps + assertions +
  readback fill + `ctx` resolution + evidence), plan (git diff + touches),
  DB-derived trust gate, flake recording.
- The op step path is what connects QA to the map runtime and makes the G0
  measurement meaningful. G0 itself remains a separate run: hand-write the
  QA-vertical ops, call them from cases, and compare steps/cost with
  `agent-browser` using the existing verifier. M1 gives that run its local
  surface; it does not replace the measurement.
- CLI: `qa init`, `list`, `plan`, `run`, `result`, `case read|write`, `verify`,
  `sync`, `report`, `doctor`.
- MCP: 12 tools — `qa_list`, `qa_plan`, `qa_run`, `qa_status`, `qa_result`,
  `qa_case_read`, `qa_case_write`, `qa_verify`, `qa_coverage`, `qa_report`,
  `qa_generate`, `qa_repair`.
- Skill: `portolan-qa`.
- Tests: unit for spec, store, plan, checks, redaction; integration with an
  injected fake substrate; one real-browser test gated on Chrome.

### M2 — generation and self-healing (shipped in 0.1.1)

- `qa generate --from-trace`: trace → draft case, plus `--spec`
  normalization. Views become `goto` steps when the route changes and no
  recorded act caused the navigation; acts with locators become semantic
  steps; secret-looking fill values become `${env.QA_*}` references. A
  writing trace without a map is generated as `read` with a warning.
- `qa repair`: replay to the recorded failure, recover the target by name
  similarity over the candidates its other locator fields match (conservative:
  exact or clearly-best matches only; a role drift demands an exact name),
  rewrite every occurrence, write the case as draft, record a `selector` drift
  event, and confirm with one run. Transient failures (the target resolves
  again) are reported, not edited.
- `qa coverage`: routes/states from case specs (crawl-driven coverage and
  the op tier remain future work).
- JUnit export (report renderer). Adapter export (Jira/Xray/TestRail/Qase)
  behind a stable interface is future work.
- Flake quarantine (recorded `quarantined` rows, skipped by `qa plan`) and
  `qa doctor` spec-drift detection are implemented. Async run start and
  `qa_cancel` remain future work.

### M3 — after G0/ADR-006 confirms the vertical

- Hosted runs, concurrency, retention, dashboards are product decisions then,
  not now.

## 12. Test plan

- Unit: schema validation (valid/invalid cases), path/id consistency, spec
  hashing, migrations idempotent, repos (cases, runs, evidence, flakes),
  glob/touches matching, fixture/env resolution, redaction, check evaluation.
- Runner: fake substrate with scripted snapshots; stale-ref retry; assertion
  failure shape; evidence files; repeat/flake; unverified refusal.
- CLI: argument parsing per command, exit codes, `--json` shapes.
- MCP: tool schemas, typed errors, capability gating for writes.
- Integration: a fixture app under `test/qa-app` served on loopback, one
  browser case, skipped when Chrome is absent (same policy as the compiler).
- Property: a generated case round-trips through write → read → sync with an
  identical `spec_sha`.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dual source of truth (files + DB) drifts | DB stores `spec_sha`; `qa sync` reconciles; `qa doctor` fails on drift; files are canonical for specs, DB for trust and history |
| A forged `verified` in a file | DB-derived trust: file status is ignored except `disabled`; only a DB `verified_sha` from `qa verify` counts |
| Secrets leak into evidence/DB | Redact before write; cap `expected`/`actual`; no raw fill values in events; screenshots off by default |
| Per-attempt browser cost (N cases × verify repeat) | M1 keeps `repeat` small; auth-fixture `storageState` reuse is M2. Do not cite a shared-session runner as isolation |
| Crowded category (Playwright, mabl, Testim, testRigor) | Differentiate on agent-native discovery, typed evidence, map reuse, and drift repair — not on case management |
| Flaky tests destroy trust | Fresh context per attempt, explicit `repeat`, quarantine, fail-closed verify gate |
| Local setup is the real onboarding cost | `qa init` + `qa doctor` own it; typed `harness_error` tells the agent what to ask the human |
| Scope creep into a TMS | Hard non-goal; export to existing tools instead |
| ADR-009 freeze | ADR-010 narrows the freeze to the QA vertical and records why |
| Secrets leak into evidence/DB | Reference-only credentials, redaction list, `.gitignore` for runs |

## 14. Open questions for review

1. Is the file + SQLite split the right call now that trust is DB-derived and
   revisions live in git?
2. Does the op-step path belong in M1, or should G0 be measured before any
   product surface exists?
3. Is a separate MCP server (`portolan qa mcp`) better than adding `qa_*` tools
   to the existing server?
4. What is the minimum evidence that makes a failure actionable without a
   screenshot in the agent's context?
5. Does `--changed` need a semantic diff (routes/features), or are `touches`
   globs enough for v1?

These were reviewed adversarially by Qwen4 Max on 2026-11-16; the trust model,
redaction, readback fill, `ctx`, and history model above incorporate that
review.
