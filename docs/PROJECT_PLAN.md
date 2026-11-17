# Portolan — Project Plan to First Release (v0.1.0)

| | |
|---|---|
| **Date** | 2026-11-08 (revised 2026-11-09) |
| **Goal** | Ship **Portolan v0.1.0**, a public alpha: an open runtime that serves verified site maps to any agent over MCP, with skills, a compiler that learns maps from runs, and published benchmark results. |
| **Timeline** | 17 weeks: Mon 2026-11-09 → release Tue **2027-03-02**. Paused until G0; dates after 2026-11-30 move with the G0 result. Includes 2 holiday/buffer weeks and ~20% buffer inside phases. |
| **Team (assumed)** | **AS**: Abubakar Siddik, founder-engineer, ~40 h/week, working with AI coding agents. **Counsel**: external, for license, ToS and trademark (~6 h total). **Partners**: 3 design partners from the chosen vertical. |
| **Constraints** | Gates G0–G2 can stop the project. No hosted service, billing, or hibernation in v0.1. Provider-agnostic from day one (ADR-003). |
| **Technical source of truth** | [`BUILD_PLAN.md`](./BUILD_PLAN.md) says *what* and *how*. This plan says *when*, *in what order*, and *who*. Where the two disagree on dates, this plan wins: BUILD_PLAN's "Day N" are ideal build days; the estimates here are realistic for one engineer. |

---

> ## Revision 2026-11-09 — G0 first
>
> The build ran ahead of G0. Phase 5 is complete, but no gate has been measured: every benchmark row is scripted, there is no oracle denominator, and the fallback path is at parity with `agent-browser` on observation tokens (ADR-002, ADR-005).
>
> **Until G0 passes on one vertical, the only scheduled work is the gate.** Choose the vertical, recruit three design partners, hand-write 3–5 ops, run `agent-browser` vs. those ops with a real model and billed usage, and write the G0 decision.
>
> **Paused until G0 passes:** Phase 2–5 feature work, Phase 6 map production, Phase 7 release prep, the cockpit, and any further fallback or browser work. The map layer is the product; the browser is the substrate.
>
> **Stop rule:** if hand-written ops do not give ≥3x fewer steps and ≥5x lower cost than `agent-browser`, stop or narrow to human-recorded maps. Do not start Phase 2–7.

### Current focus (next three weeks)

| Order | Task | Status | Effort | Done |
|---|---|---|---|---|
| 1 | **T6.01** Score 3 candidate verticals | **Done** — [scorecard](./VERTICALS.md); QA automation added 2026-11-15 as candidate D (80/100) | 4h | Scorecard: site count, repeat volume, write risk, budget, reachable buyers |
| 2 | **T6.02** Run 8 discovery interviews (not 15) | Next | 8h | Pain, volume, budget, and one workflow to test per interview |
| 3 | **T6.03** Decide the vertical (ADR-006) | Pending | 2h | ADR merged; one vertical named |
| 4 | **T6.05** Recruit 3 design partners | Pending | 8h | 3 signed; test accounts provisioned |
| 5 | **T1.12** Hand-write oracle ops for 3–5 workflows | Pending | 6h | Every op passes its unit test on the real site |
| 6 | **T1.13** Oracle MCP server | Pending | 3h | The runner calls the ops over MCP |
| 7 | **T1.14** Run G0: `agent-browser` vs. ops, 2 providers, billed usage | Pending | 6h | G0 report in `bench/results/`; ADR-005 updated |
| 8 | **T4.14** Write the G0 decision | Pending | 2h | ADR merged; pass → G1, fail → stop or narrow |

**T6.01 result:** procurement portals score highest (**87/100**) on G0 feasibility, write risk, buyer reachability, and lack of a standard API. Insurance eligibility scores lowest (61) because PHI and payer credentials make a three-week gate unrealistic. Interview procurement first, logistics second. Full scoring and sources: [docs/VERTICALS.md](./VERTICALS.md).

**Revised 2026-11-15:** the founder named **QA automation** as the initial product goal (end goal unchanged: an agent-native runtime that does what a human does, without the human UI). It is scored as candidate D (**80/100**) — the cheapest G0 to run and the easiest partner recruitment, with the weakest write-safety wedge. Interview order is now procurement first, QA second. T6.03 may pick D if QA interviews show budget for maintenance reduction.

**Target:** Mon 2026-11-30. No Phase 2–7 commit before this table is complete.

---

## 1. What "first release" means

**v0.1.0 ships when all of these are true:**

| # | Release criterion | Measured by |
|---|---|---|
| R1 | `npx @abubakarsiddiik/portolan serve` and the Docker image start the MCP server on macOS and Linux from a clean machine | RC install test (T7.09) |
| R2 | Works in ≥3 MCP clients (Claude Code, Codex CLI, one of Gemini CLI / Cursor / VS Code) with the `portolan` skill | Conformance suite (T4.13, T7.09) |
| R3 | Works with ≥2 model providers; gates hold on both | Benchmark (T4.11) |
| R4 | Gates G0, G1, G2 passed and recorded in `DECISIONS.md` | ADR-005 |
| R5 | Verified maps for **≥10 sites** in the chosen vertical, canary pass rate **≥95% over 7 days** | Health endpoint (T4.02) |
| R6 | **Zero duplicate writes** across all test suites and pilots | Safety tests + audit log |
| R7 | 3 design partners ran real work through it; ≥1 quotable result | Pilot reviews (T6.07) |
| R8 | Public docs: quickstart, concepts, map format spec v0, per-client setup, write safety | Docs site (T7.02) |
| R9 | Benchmark report published with methods and raw data | T7.03 |
| R10 | License chosen; trademark search done; npm scope and GitHub org secured | T7.05, T7.06 |

**G0 is first in time, not last.** No release work (R1, R5, R7–R10) starts until G0 passes. R4 stays open until G0–G2 are measured (ADR-005).

**Not in v0.1.0:** hosted runtime, billing, `freeze`/`hibernate`, SkillWeaver-style exploration, WebMCP tier, Lightpanda tier, human "record a workflow" UI, and the human cockpit. These are v0.2+ (§9). The cockpit is the first post-release workstream (ADR-007) and must not delay a gate.

---

## 2. Milestones

**Active milestone: M1 only.** M2–M10 are paused until G0 passes. M6 (vertical) moves ahead of M2 because G0 needs a vertical.

| # | Milestone | Target | Owner | Success criteria |
|---|---|---|---|---|
| M0 | Repo and tooling ready | Mon 2026-11-09 | AS | CI green; commit convention enforced (§8) |
| M1 | **G0: perfect ops win** | Mon 2026-11-30 | AS | Hand-written ops vs `agent-browser`: steps ≤⅓, $ ≤⅕, success ≥ B−2 pts, on 2 providers |
| M2 | Runtime runs maps | Fri 2026-12-11 | AS | Oracle maps run through the runtime with parity; write-safety tests pass; MCP works in Claude Code + Codex CLI |
| M3 | Compiler produces verified maps | Fri 2027-01-08 | AS | Dev fixtures compile to verified maps from traces, no human edits |
| M4 | **G1: compilation works** | Fri 2027-01-15 | AS | Held-out: ≥60% of oracle's $ win, yield ≥50%, break-even K ≤3, holds on 2 providers |
| M5 | **G2: drift and safety** | Fri 2027-01-22 | AS | ≥80% auto-repair within 2 runs; 0 duplicate writes. ADR-005 written |
| M6 | Vertical chosen, partners signed | Fri 2026-11-27 | AS | ADR-006; 3 pilot agreements. Precedes M2. |
| M7 | Release-hardened | Fri 2027-02-05 | AS | Security, packaging, CLI, observability tasks done |
| M8 | 10 vertical maps live with partners | Fri 2027-02-19 | AS + Partners | R5 canaries started; pilots running |
| M9 | Release candidate `v0.1.0-rc.1` | Wed 2027-02-24 | AS | R1, R2, R8 pass on clean machines |
| M10 | **v0.1.0 released** | Tue 2027-03-02 | AS | All of §1 true |

**Stop/branch points:** M1 fails → stop or narrow; do not start Phase 2–7. M4 fails → narrow to human-recorded maps (§7.2). M5 fails → reads-only release or stop.

---

## 3. Calendar

### 3.1 Current calendar — G0 vertical (active)

| Week | Dates | Focus | Phase |
|---|---|---|---|
| W1 | Nov 9–13 | Vertical scorecard, interviews, hand-write the first ops | P6, P1 |
| W2 | Nov 16–20 | Vertical decision (ADR-006), 3 partners, finish ops | P6, P1 |
| W3 | Nov 23–27 | **G0 run**: `agent-browser` vs. ops, 2 providers, billed | P1 |
| W4 | Nov 30–Dec 4 | G0 decision; if pass, start compiler/G1; if fail, stop or narrow | P1 → P4 |

**W5 onward is paused until G0 passes.** The original calendar below is the post-G0 plan, not a schedule of current work.

### 3.2 Post-G0 calendar (paused until G0 passes)

| Week | Dates | Focus | Phase |
|---|---|---|---|
| W1–W4 | Nov 9–Dec 4 | **Superseded by 3.1 (G0 vertical)** | P0 |
| W5 | Dec 7–11 | Extractors, url/http tiers, write safety → **M2** | P2 |
| W6 | Dec 14–18 | Fallback scopes, trace recorder, segmenter | P3 |
| W7 | Dec 21–25 | **Holiday / buffer** (light: discovery calls, reading) | — |
| W8 | Dec 28–Jan 1 | **Holiday / buffer** | — |
| W9 | Jan 4–8 | Parameterize, lift, verify, publish, skill export → **M3** | P3 |
| W10 | Jan 11–15 | v2 fixtures, repair loop, held-out sites, benchmark → **G1** | P4 |
| W11 | Jan 18–22 | Drift run, conformance, analysis → **G2**; vertical decision | P4, P6 |
| W12 | Jan 25–29 | Hardening: security, sessions, packaging | P5 |
| W13 | Feb 1–5 | Hardening: CLI, release automation → **M7**; start vertical maps | P5, P6 |
| W14 | Feb 8–12 | Vertical maps; partner onboarding | P6 |
| W15 | Feb 15–19 | Pilots; docs; spec; benchmark report → **M8** | P6, P7 |
| W16 | Feb 22–26 | **RC** (Wed), RC fixes, launch assets | P7 |
| W17 | Mar 1–5 | **Release Tue Mar 2**; post-launch triage | P7 |

Discovery interviews (T6.02) are compressed into W1–W2 of the current G0 calendar.

---

## 4. Work breakdown

Effort is AS hours unless noted. "Done" is what a reviewer checks. Every task is one branch and one PR (§8). IDs are stable: use them in branch names, PR titles and issue titles.

### Phase 0 — G0 vertical (current, ~39 h)

**This is the only active phase.** It ends with a measured G0, not with more code.

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T6.01 | Score candidate verticals (insurance eligibility, procurement portals, logistics carriers; QA automation added 2026-11-15) | 4h | — | Scorecard: site count, repeat volume, write risk, budget, reachable buyers |
| T6.02 | Run 8 discovery interviews (compressed from 15) | 8h | T6.01 | Notes with pain, volume, budget, and one workflow to test |
| T6.03 | Decide the vertical (ADR-006) | 2h | T6.02 | One vertical named; ADR merged |
| T6.05 | Recruit 3 design partners; sign pilot agreements | 8h | T6.03 | 3 signed; test accounts provisioned |
| T1.12 | Hand-write oracle ops for 3–5 workflows on the chosen sites | 6h | T6.03 | Every op passes its unit test on the real site |
| T1.13 | Build the oracle MCP server | 3h | T1.12 | The runner calls the ops over MCP |
| T1.14 | Run G0: `agent-browser` vs. ops, 2 providers, billed usage | 6h | T1.13, T6.05 | G0 report in `bench/results/`; ADR-005 updated |
| T4.14 | Write the G0 decision | 2h | T1.14 | ADR merged; pass → G1, fail → stop or narrow |

**Phase 2–7 below are paused until G0 passes.** Their estimates and dates are the post-G0 plan.

### Phase 1 — Foundations and G0 (W1–W2, ~58 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T1.01 | Init pnpm workspace, TS config, Biome, Vitest, GitHub Actions CI | 3h | — | `pnpm i && pnpm test && pnpm lint` green in CI |
| T1.02 | Add commit convention: commitlint config, CI check, PR template, `CONTRIBUTING.md` (§8) | 2h | T1.01 | A non-conforming commit fails CI |
| T1.03 | Build `packages/model`: `ModelPort`, Anthropic + OpenAI adapters, per-role config | 5h | T1.01 | Structured-output test passes against both providers; usage reported |
| T1.04 | Build fixture server and **store** fixture v1 (catalog, variants, cart, checkout, orders) | 5h | T1.01 | Store runs locally; order ids observable for predicates |
| T1.05 | Build **wizard** fixture v1 (multi-step form, validation, file upload) | 4h | T1.04 | Wizard runs; submission observable |
| T1.06 | Build **data-portal** fixture v1 (table, filter, paginate, CSV export, login) | 4h | T1.04 | Portal runs; export observable |
| T1.07 | Write dev task templates, param sets and success predicates (3 sites × 3 templates × 5 params) | 3h | T1.04–06 | Predicates pass on scripted happy paths |
| T1.08 | Build bench result schema, billed-usage capture, `table.md` generator v0 | 4h | T1.03 | A dummy run writes `results.jsonl` and a table |
| T1.09 | Build arm A: pinned `browser-use` runner in isolated venv, 2 providers | 4h | T1.07, T1.08 | Arm A completes dev templates; usage per step recorded |
| T1.10 | Build common runner: AI SDK loop as an MCP client, history policy flag, caching flag | 6h | T1.03, T1.08 | Runner drives a toy MCP server on both providers |
| T1.11 | Build arm B: `agent-browser` backend for the runner | 3h | T1.10 | Arm B completes dev templates |
| T1.12 | Write oracle ops for the 3 dev fixtures as Playwright functions | 6h | T1.04–06 | Each op passes its unit test |
| T1.13 | Build oracle MCP server (portable `list_sites`/`open_site`/`call` surface) | 3h | T1.12 | Runner calls oracle ops over MCP |
| T1.14 | Run A, B, D-oracle on dev × 2 providers; write G0 report | 4h | T1.09, T1.11, T1.13 | **G0 decision** recorded in `bench/results/` and summarized in `DECISIONS.md` |
| T1.15 | Buffer | 2h | — | — |

### Phase 2 — Core runtime (W2–W5, ~118 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T2.01 | Define `packages/protocol`: Zod schemas, error codes, result envelope | 4h | T1.01 | Schemas round-trip; error codes documented |
| T2.02 | Define map JSON Schema v0 + Ajv loader | 5h | T2.01 | Valid and invalid sample maps behave as expected |
| T2.03 | Add portable-schema lint for op params/returns and tool names | 3h | T2.02 | Lint flags `oneOf`, `$ref`, long/dotted names |
| T2.04 | Port oracle ops to map files (`maps/<fixture>/v1.json`) | 4h | T2.02, T1.12 | Maps validate and pass lint |
| T2.05 | Write the `portolan` skill v0 (`skills/portolan/SKILL.md`) | 2h | T2.04 | Skill validates; reviewed against BUILD_PLAN §7A |
| T2.06 | Build Fastify server skeleton, sessions, SQLite store | 4h | T2.01 | Create/close session; typed `bad_request` on malformed input |
| T2.07 | Build Playwright engine adapter (navigate, snapshot, dispatch, evaluate) | 6h | T2.06 | Adapter contract tests pass on fixtures |
| T2.08 | Build MCP server portable surface (stdio + Streamable HTTP) | 5h | T2.06 | MCP inspector lists tools; `call` reaches the runtime |
| T2.09 | Add native ops via `tools/list_changed`, name sanitizing, tool budget | 3h | T2.08 | Native tools appear after `open_site` in a supporting client |
| T2.10 | Build semantic capture: AX tree + DOMSnapshot merge on `backendNodeId` | 6h | T2.07 | Snapshot contains role, name, bounds, visibility for fixtures |
| T2.11 | Add actionable filter, `ctx`, ranking, budget | 6h | T2.10 | Every required interaction on dev fixtures present; p50 ≤800 tokens |
| T2.12 | Add refs: hashing, collision extension, `(sid, doc)` scope, stale detection | 5h | T2.10 | Forced-collision and stale-ref tests pass |
| T2.13 | Build `act`: resolve, scroll, hit-test, input, `blocker_ref`, quiescence | 8h | T2.12 | Click/type/select/press work; overlay returns `blocker_ref` |
| T2.14 | Add effects and delta v0 | 5h | T2.13 | Effects classified on fixtures; delta ≤15% on non-nav acts |
| T2.15 | Build state recognizer (URL pattern + marks) | 4h | T2.10, T2.02 | Every fixture state recognized; no false positives in tests |
| T2.16 | Build router (read-only BFS over `from → to`) | 3h | T2.15 | Routes to precondition states; never inserts writes |
| T2.17 | Build `ui` tier executor with locator → ref resolution | 5h | T2.13, T2.15 | Oracle ui ops run through the runtime |
| T2.18 | Build extractors (`fields`, `rows`), Ajv returns, post-checks | 6h | T2.17 | Returns validate; schema miss is an op failure |
| T2.19 | Add parity test: runtime vs Day-2 oracle functions | 3h | T2.18 | Identical results on all dev templates |
| T2.20 | Build `url` tier | 3h | T2.18 | URL ops pass parity |
| T2.21 | Build in-page `http` tier with `bind` | 6h | T2.18 | HTTP ops pass parity, including a CSRF-protected endpoint |
| T2.22 | Add write safety: `confirm`, idempotency, `outcome_check`, `unknown_outcome` | 6h | T2.17 | Safety unit tests pass |
| T2.23 | Add audit log for writes | 3h | T2.22 | Every write has params, tier, before/after state, requests |
| T2.24 | Add forced mid-write failure test on the store | 2h | T2.22 | Produces `unknown_outcome`; never a second order |
| T2.25 | Run client smoke: Claude Code + Codex CLI with the skill | 3h | T2.09, T2.05 | Both clients open a fixture and complete a template |
| T2.26 | Buffer | 10h | — | — |

### Phase 3 — Fallback and compiler (W6, W9; ~84 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T3.01 | Add fallback scopes (`fallback_begin`/`done`, write scoping) | 5h | T2.13, T2.22 | Other write ops refused inside a write scope |
| T3.02 | Build trace recorder: locators, values, pre/post states | 5h | T3.01 | Complete trace for every fallback scope |
| T3.03 | Add per-action network capture (CDP `Network`, JSON bodies) | 5h | T3.02 | Requests attributed to the action that caused them |
| T3.04 | Store traces as JSONL + HAR | 2h | T3.03 | Traces reload losslessly |
| T3.05 | Build arm C backend (substrate affordances only) | 2h | T1.10, T2.14 | Arm C completes dev templates |
| T3.06 | Build headless repair agent via `ModelPort` | 5h | T1.03, T3.01 | Completes an intent on a fixture with a local open-weights model |
| T3.07 | Build segmenter: state cuts + LLM labeling against existing map | 8h | T3.02 | Dev traces segment into the oracle's op boundaries on ≥2/3 sites |
| T3.08 | Build parameterizer: value matching, multi-trace diff | 8h | T3.07 | Params match oracle signatures on ≥2/3 sites |
| T3.09 | Add returns inference: extractor + JSON Schema + field naming | 6h | T3.07 | Inferred returns validate on held-back runs |
| T3.10 | Add lift to `url` routes | 4h | T3.08 | Search/filter ops lifted on store and portal |
| T3.11 | Add lift to `http` with request matching and `bind` resolution | 8h | T3.08, T3.03 | At least one write lifted with `outcome_check` |
| T3.12 | Build verifier: fresh session, ≥3 param sets, checks | 6h | T3.09 | Verified/rejected with a report per impl |
| T3.13 | Build publisher: map versioning, diff, review gate for irreversible | 3h | T3.12 | New version written; irreversible ops held for review |
| T3.14 | Build skill exporter: `portolan-<site>`, recipe mining, references | 6h | T3.13 | Generated skills validate; carry `map_version` |
| T3.15 | Compile dev fixtures end to end; compare with oracle | 4h | T3.14 | Report: coverage, yield, tier mix vs oracle |
| T3.16 | Buffer | 8h | — | — |

### Phase 4 — Drift, benchmark, G1/G2 (W10–W11, ~75 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T4.01 | Build v2 variants of the 3 dev fixtures (renames, moved route, API param rename, modal) | 6h | T1.04–06 | Switching v1→v2 breaks known ops |
| T4.02 | Add canary scheduler and op health endpoint | 4h | T3.12 | `/v1/sites/{site}/health` shows per-op status |
| T4.03 | Build repair loop: degraded → fallback → recompile one op → publish | 6h | T4.02, T3.06 | v2 breakages re-verified without human edits |
| T4.04 | Build 2 held-out fixtures with v1 and v2 | 8h | T1.04 | Fixtures run; predicates pass |
| T4.05 | Set up WebArena shopping + GitLab via Docker | 6h | — | Both apps reachable and resettable |
| T4.06 | Write held-out templates, params, annotations (16 templates) | 5h | T4.04, T4.05 | Predicates pass on scripted happy paths |
| T4.07 | Add scoring, template-bootstrap CIs, final table generator | 5h | T1.08 | Table regenerates from raw results |
| T4.08 | Add open-weights smoke via OpenAI-compatible adapter | 2h | T1.03 | One template completes on a local model |
| T4.09 | Pilot N=1 all arms; fix harness bugs only | 6h | T4.06, T4.07 | Every arm/template produces a scored row |
| T4.10 | Freeze commit; compile held-out maps from fallback runs | 4h | T4.09 | Maps compiled with model X; SHA recorded |
| T4.11 | Run N=3, all arms × 2 providers + transfer runs (model Y) | 6h | T4.10 | Raw results committed |
| T4.12 | Run drift: switch to v2 mid-benchmark | 4h | T4.03, T4.11 | Repair rate, duplicates, drift-day success recorded |
| T4.13 | Run client conformance suite in 3 clients | 4h | T2.25 | Pass/fail per client recorded |
| T4.14 | Write analysis and ADR-005 (G1/G2 outcome) | 4h | T4.11–13 | Decision merged |
| T4.15 | Buffer | 5h | — | — |

### Phase 5 — Harden for release (W12–W13, ~60 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T5.01 | Add credential store (env + OS keychain), scoped per site | 5h | T4.14 | No credentials in maps, traces, logs or skills (test) |
| T5.02 | Add egress allowlist and per-site policy file | 4h | T5.01 | Off-allowlist requests blocked and logged |
| T5.03 | Label untrusted data in MCP results; add injection test pages | 4h | T2.18 | Injection fixtures don't change agent tool calls in the test suite |
| T5.04 | Add session lifecycle: TTL, caps, cleanup, crash recovery | 5h | T2.06 | Kill-9 test recovers; no orphan browsers |
| T5.05 | Add observability: structured logs, `portolan doctor` | 4h | T2.06 | `doctor` diagnoses browser, config, providers, clients |
| T5.06 | Build CLI: `init`, `serve`, `compile`, `verify`, `export-skills`, `bench` | 6h | T3.14 | `--help` complete; e2e test per command |
| T5.07 | Document config file options | 3h | T5.06 | Every option documented with a default |
| T5.08 | Package: npm under `@abubakarsiddiik` scope with provenance; Docker image with Chromium | 6h | T5.06 | Clean-machine install works on macOS + Linux |
| T5.09 | Add release automation: Changesets, semver, GitHub release workflow | 4h | T5.08 | Dry-run release produces notes and artifacts |
| T5.10 | Write install snippets for Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code | 4h | T5.08 | Each snippet tested |
| T5.11 | Performance pass on op calls | 4h | T2.19 | p50 ≤500 ms per `ui` op and ≤150 ms per `url`/`http` op on fixtures |
| T5.12 | Threat model + security review of the write path | 5h | T5.01–03 | `docs/SECURITY.md`; findings fixed or ticketed |
| T5.13 | Raise runtime + safety test coverage to ≥80% lines | 6h | — | Coverage report in CI |

### Phase 6 — Vertical and design partners (W2–W15, interleaved, ~93 h)

**T6.01–T6.03 and T6.05 moved to Phase 0 (current).** The rows below are the post-G0 remainder; T6.02 is compressed to 8 interviews in Phase 0.

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T6.01 | Score candidate verticals (insurance eligibility, procurement portals, logistics carriers; QA automation added 2026-11-15) | 4h | — | Scorecard: site count, repeat volume, write risk, budget, reachable buyers |
| T6.02 | Run 15 discovery interviews (~1h each, W2–W10) | 15h | T6.01 | Notes + pain/volume/budget per interview |
| T6.03 | Decide vertical (ADR-006) | 2h | T6.02, T4.14 | ADR merged |
| T6.04 | Select 10 target sites; ToS review per site (with Counsel) | 6h + 2h Counsel | T6.03 | Allow-list with ToS notes; no site that forbids automation |
| T6.05 | Recruit 3 design partners; sign pilot agreements | 8h | T6.03 | 3 signed; test accounts provisioned |
| T6.06 | Compile and verify maps for 10 sites (~4h/site) | 40h | T6.04, T5.01 | 10 maps verified; canaries running |
| T6.07 | Onboard partners; weekly pilot reviews (W14–W17) | 12h | T6.05, T6.06 | Usage, success, incidents tracked weekly |
| T6.08 | Collect pilot metrics; draft case study | 4h | T6.07 | One quotable result approved by the partner |

### Phase 7 — Release prep and launch (W15–W17, ~71 h)

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T7.01 | Write map format spec v0 (`docs/spec/map-v0.md`) | 6h | T2.02 | Spec covers every field; examples validate |
| T7.02 | Build docs site: quickstart, concepts, MCP setup, skills, write safety | 10h | T5.10, T7.01 | New user reaches a working call in ≤10 minutes (tested by someone else) |
| T7.03 | Publish benchmark report with methods and raw data | 6h | T4.14 | Report + data public |
| T7.04 | Rewrite PRD v0.2 | 4h | T4.14 | PRD matches ADR-002–006 |
| T7.05 | Choose license (lean: Apache-2.0 runtime, CC-BY map spec); add LICENSE files | 2h + 2h Counsel | — | Licenses in repo; dependency licenses checked (no AGPL in default path) |
| T7.06 | Trademark search; secure npm scope, GitHub org, domain | 3h + 2h Counsel | — | Clearance memo; names secured |
| T7.07 | Write README / landing page; record 2-minute demo | 8h | T6.06 | Demo shows open_site → 3 calls → done, plus a drift repair |
| T7.08 | Publish examples repo (fixture maps + one real-site map) | 3h | T6.06 | Examples run from README |
| T7.09 | Cut `v0.1.0-rc.1`; clean-machine install test on macOS + Linux across clients | 4h | T5.08, T7.02 | R1, R2, R8 pass |
| T7.10 | Fix RC issues | 8h | T7.09 | No open release-blocking issues |
| T7.11 | Tag `v0.1.0`; publish npm, Docker, skills; list in MCP registry | 3h | T7.10 | Artifacts live; install from public registries works |
| T7.12 | Launch post, HN/X, partner quote | 4h | T7.11, T6.08 | Published |
| T7.13 | Post-launch triage (first week) | 10h | T7.11 | Issues labeled; P0 bugs fixed within 48h |

**Total:** ~560 h engineering + ~6 h counsel for the post-G0 plan, plus ~39 h for the current G0 phase. At ~40 h/week over 15 working weeks that is ~93% utilization, with buffer tasks inside each phase and two holiday weeks as overflow.

---

## 5. Dependencies and critical path

**Current (G0):** `T6.01 → T6.02 → T6.03 → T6.05 → T1.12 → T1.13 → T1.14 (G0)`.
**Post-G0:** the graph below.

```
T1.01 ─┬─ T1.03 ─ T1.10 ─ T1.11 ─┐
       ├─ T1.04..06 ─ T1.07 ─ T1.09 ┼─ T1.14 (G0) ─┐
       └─ T1.12 ─ T1.13 ───────────┘               │
                                                    ▼
T2.01 ─ T2.06 ─ T2.07 ─ T2.10 ─ T2.12 ─ T2.13 ─ T2.17 ─ T2.18 ─┬─ T2.20/T2.21 (tiers)
   └─ T2.02 ─ T2.04 ── T2.15 ─ T2.16 ─────────┘                  └─ T2.22 ─ T2.24 (safety)
                                                                        │
T3.01 ─ T3.02 ─ T3.03 ─ T3.07 ─ T3.08 ─ T3.11 ─ T3.12 ─ T3.13 ─ T3.14 ─┘
                                                    │
T4.01 ─ T4.03 ──────────┐                           ▼
T4.04/T4.05 ─ T4.06 ─ T4.09 ─ T4.10 ─ T4.11 ─ T4.12 ─ T4.14 (G1, G2)
                                                         │
T6.01 ─ T6.02 ──────────────────────────────── T6.03 ────┼─ T6.04 ─ T6.06 ─ T6.07
                                                         ▼
                        T5.01..13 ─ T5.08 ─ T7.09 (RC) ─ T7.10 ─ T7.11 (release)
```

**Critical path:** T1.01 → G0 → semantic capture → `act` → UI tier → extractors → trace recorder → segmenter → parameterizer → verifier → held-out run → G1/G2 → credential store → 10 vertical maps → RC → release.

**Parallel lanes for AI coding agents** (independent once their inputs exist): fixtures (T1.04–06, T4.01, T4.04); bench plumbing (T1.08, T4.07); adapters (T1.03, T4.08); lint and schema (T2.02–03); docs (T5.07, T5.10, T7.01). Review every agent PR as if a contractor wrote it.

**Bottlenecks:** the segmenter/parameterizer (T3.07–08) is the research risk; the 10 vertical maps (T6.06) is the volume risk; both sit on the critical path.

---

## 6. Risks

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| G0 fails (perfect ops don't win by enough) | High | Medium | Learned by Nov 30 for ~39 h; stop or reframe before more runtime work |
| Compiler (T3.07–08) takes 2–3x estimate | High | High | 16h buffer in P3 + holiday weeks; fallback strategy: human-recorded maps (§7.2) |
| WebArena setup eats days | Medium | Medium | Slip order: drop GitLab, keep shopping; never drop drift run |
| Vertical sites forbid automation or need partner accounts | High | Medium | ToS review in T6.04; partners provide accounts; prefer partner-owned portals |
| Design partners slow to sign | Medium | High | Start recruiting in W9 from interview pool; 5 candidates for 3 slots |
| Name/trademark conflict found late | Medium | Low | T7.06 moved earlier if Counsel available; scoped npm packages |
| Provider API or AI SDK changes | Low | Medium | Pin versions; adapters isolated in `packages/model` |
| Solo bandwidth (illness, interruptions) | High | Medium | Holiday buffers; agent-parallel lanes; RC date can slip one week without moving scope |
| Scope creep (hibernate, hosted, exploration) | Medium | High | §1 "Not in v0.1.0" is binding; new ideas go to `docs/ROADMAP.md` |

---

## 7. Decision points

### 7.1 Gate calendar

| Date | Gate | If pass | If fail |
|---|---|---|---|
| Mon Nov 30 | **G0** | Proceed to compiler/G1; resume Phase 2–7 only after G0 | **Stop or narrow; do not start Phase 2–7** |
| Post-G0 | G1 | Proceed | §7.2 |
| Post-G0 | G2 | Release with writes | Release reads-only (writes behind a flag), or stop |

**No Phase 2–7 work starts before the G0 row.** G1 and G2 dates move with the G0 result.

### 7.2 If G1 fails: narrowed release

Replace the compiler as the map source with a **recorded-workflow authoring tool** (a human demonstrates, the compiler only parameterizes and verifies). P3's verifier, publisher and skill exporter stay; T3.07 is replaced by a recorder UI (~30 h). Release moves ~2 weeks.

---

## 8. Way of working

### 8.1 Commit convention

All commits use **Conventional Commits** with a lowercase, imperative subject:

```
<type>(<scope>): <verb> <what>

<body: why, wrapped at 72>

Refs: T2.13
Co-Authored-By: …   (when applicable)
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`.
- **Scopes:** `protocol`, `substrate`, `runtime`, `compiler`, `model`, `skills`, `server`, `cli`, `bench`, `fixtures`, `docs`.
- **Subject:** imperative verb, all lowercase, no trailing period, ≤72 characters. ✅ `feat(runtime): add read-only state router` · ❌ `Added Router.` · ❌ `feat: Router`.
- **One logical change per commit.** Refactors separate from behavior changes. Tests in the same commit as the code they test.
- **Breaking changes:** `!` after the type and a `BREAKING CHANGE:` footer.
- Enforced by commitlint in CI (T1.02).

### 8.2 Branches, PRs, issues

- **Branch per task:** `<type>/<task-id>-<slug>`, e.g. `feat/t2.13-act-hit-test`.
- **PR title** follows the commit convention; squash-merge so `main` reads as one conventional commit per task.
- **Issues:** one per task ID; labels `phase:1`–`phase:7`, `type:*`, `gate`, `blocked`, `agent-ok` (safe to delegate to a coding agent).
- **GitHub milestones** = M0–M10 in §2.

### 8.3 Cadence

- **Daily:** move the issue board; note blockers in the issue.
- **Friday (30 min):** demo what merged; re-estimate the next week; update this plan's dates if the critical path moved.
- **At each gate:** write the ADR before starting the next phase.

---

## 9. After v0.1.0 (not scheduled)

The cockpit is the first post-release workstream (ADR-007). It is a projection of the session event log, not a second browser, and it must not delay a gate.

| ID | Task | Effort | Depends on | Done criteria |
|---|---|---|---|---|
| T8.01 | Session event log: append-only schema, writer, reader, replay | 5h | T2.06 | Every observation, action, effect and write is an event; replay is lossless |
| T8.02 | Control bus: `control_owner`, pause/resume, takeover | 4h | T8.01 | The agent cannot act while a human owns control; release re-observes and bumps `v` |
| T8.03 | Cockpit package: live viewport, timeline, inspector | 10h | T8.01 | A human can watch a session and inspect every step |
| T8.04 | Redaction and local auth for the cockpit | 4h | T8.03 | Secrets are masked; localhost plus a session token only |
| T8.05 | Takeover UX and conflict tests | 4h | T8.02, T8.03 | A human can take over a paused session; refs are invalidated on release |
| T8.06 | Replay and audit export | 3h | T8.01 | A session can be replayed and exported as JSONL |

Also after v0.1.0: `freeze`/`hibernate`; WebMCP tier; SkillWeaver-style exploration; recorded-workflow UI; hosted runtime and billing; Lightpanda tier (after license review); vertical map library growth; multi-tab sessions.
