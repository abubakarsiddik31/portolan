# Portolan — Product Requirements Document

| | |
|---|---|
| **Product** | Portolan |
| **Version** | 0.2 |
| **Date** | 2026-11-09 |
| **Owner** | Abubakar Siddik |
| **Status** | Pre-release. Phase 5 (harden) is complete; the G0/G1/G2 gates are **not passed** (ADR-005). |
| **Supersedes** | v0.1 (2026-11-08). What moved is recorded in Appendix C. |
| **One-liner** | Portolan turns a website into a map an agent can call: verified, typed operations that replace click-by-click browsing. |

---

## 1. Problem

Agents drive the web through interfaces built for humans. The cost is in the
number of steps, not only in the size of each step.

**1.1 Agents receive documents, not capabilities.**
The dominant pattern is to serialize the DOM or a screenshot and ask the model
what to do. Raw HTML for a commerce page runs 50k–400k tokens; a screenshot
costs ~1.5k tokens and forces visual reasoning. Both describe the page; neither
says what the site can do.

**1.2 Steps multiply cost and failure.**
A ten-click checkout is ten model turns, ten observations, and ten chances to
misread a label. Even a perfect per-step formatter leaves ten steps. The
lever that survives cheaper tokens is replacing the sequence with a typed
call.

**1.3 Free tools already format the step.**
`agent-browser` and Playwright MCP give an agent a compact view and a click.
An affordance browser measured against them wins ~1.15x — not enough to be a
product (ADR-002).

**1.4 A verified map compounds; a formatting layer does not.**
A map of a site is reusable evidence: every agent that calls `search` benefits
from the run that verified it, and a repair improves it for all of them. That
is the asset.

**The gap:** nobody sells a *map of what a site can do*, with the execution and
write safety to use it.

---

## 2. Thesis

> Move the site's capabilities out of the conversation and into a verified map.

Portolan serves each site as a **map**: named states, typed operations with
`params` and `returns`, declared effects, and transitions. The agent calls an
operation. The runtime executes it through the cheapest verified path.

Three consequences:

- **Steps, not tokens per step.** One `checkout(email)` replaces eight clicks.
- **Typed data, not labels.** `search(query)` returns rows with ids and
  prices, so the agent does not have to read a page to use the result.
- **Writes become governable.** Declared effects, confirmation, idempotency,
  and `unknown_outcome` are what let a platform team allow a purchase at all.

**Positioning:** Portolan is not a browser for agents. It is an API layer for
websites that happens to run on one.

---

## 3. Goals and non-goals

### Goals

| ID | Goal | Gate or measure |
|---|---|---|
| G0 | Hand-written ops beat the best free browser tool | ≥3x fewer steps and ≥5x cheaper than `agent-browser` on perfect ops |
| G1 | Compiled maps keep most of the oracle's win | ≥60% of the oracle win, ≥50% compile yield, break-even at K≤3 calls |
| G2 | Maps survive drift without duplicate writes | ≥80% auto-repair, zero duplicate writes |
| — | Fast calls | p50 ≤500ms `ui`, ≤150ms `url`/`http` on fixtures |
| — | Install anywhere | macOS and Linux, any MCP client |
| — | Safe writes | confirmation, idempotency, `unknown_outcome`, audit |

**Gate status (ADR-005):** G0, G1, and G2 are **not passed**. The current
artifacts are harness validations on a scripted provider, not gate results.
v0.1.0 is not released on that evidence.

### Non-goals (v0.1)

- A rendering engine. Portolan rents Chromium behind a substrate adapter.
- A human browser UI; the cockpit is a later projection of the same session.
- A search engine or a bulk crawler.
- An LLM in the verified op hot path.
- Consumer distribution.

---

## 4. Users

**Primary — agent platform engineers.** Teams running autonomous web
workflows who own a bill and a pager. They adopt a session model when it cuts
steps and makes writes governable.

**Secondary — vertical AI SaaS teams.** Insurance eligibility, invoice
reconciliation, procurement, travel rebooking: the web interaction is the
bottleneck, and they buy outcomes.

**Tertiary — OSS agent developers.** Adopt the MCP server and the skill
format; they are the distribution channel.

**Anti-persona.** Humans browsing; petabyte-scale scrapers; teams with
<$500/month of web automation.

### Jobs to be done

- "When my agent needs a site with no API, I want it to succeed in fewer
  steps and fewer dollars, so my unit economics work."
- "When my agent fails halfway through a checkout, I want to resume where it
  left off instead of restarting, so I stop paying twice."
- "When finance asks why agent costs are what they are, I want a per-task
  meter I can defend."

---

## 5. Competitive position

| Alternative | What it gives you | Where it falls short |
|---|---|---|
| Chrome + CDP clouds (Browserbase, Steel, Browser Use Cloud) | A real browser, any site | Document-shaped output; steps remain; priced per hour |
| `agent-browser`, Playwright MCP, browser-use, Stagehand | An agent loop over a real browser | State and know-how live in the conversation; no map; retries |
| Workflow recorders (WALT, workflow-use) | One recorded task | No shared state model; every task is a new recording |
| Integuru/Parse-style network APIs | Fast private endpoints | Unsafe writes without the site's client logic; breaks silently |
| WebMCP | Sites declare typed tools | Requires site cooperation; years from coverage |
| **Portolan** | **A verified map per site, typed calls, tiered execution, write safety, drift repair** | **Compilation is a research risk; ToS exposure for private endpoints** |

**Moat (honest):** the state model, write safety, published verification and
drift numbers, and one vertical's map library. Not the compilation technique;
that space is crowded.

---

## 6. Product surface

The product is four surfaces over one session: MCP, the CLI, the map format,
and generated skills.

### 6.1 MCP (execution)

| Tool | Input | Result |
|---|---|---|
| `open_site` | `{ site }` | Compact map, pinned version, session |
| `call` | `{ op, params, confirm?, idempotency_key? }` | Typed result or typed error |
| `view` | `{}` | URL, state, ranked affordances, text, refs |
| `act` | `{ ref, do, value?, key? }` | Delta and effects |
| `read` | `{ ref? }` | Page or element text |
| `fallback_done` | `{ result? }` | Trace for the fallback scope |

`call` is the fast path. `view` / `act` / `read` are the caller's fallback when
no op fits; Portolan runs no second agent for a live call.

Every page-derived result is labeled `untrusted: true` with a notice. Page
text is data, not instructions.

### 6.2 CLI

`init`, `serve`, `mcp`, `compile`, `verify`, `export-skills`, `bench`,
`doctor`. See [docs/CONFIG.md](./docs/CONFIG.md) and
[docs/INSTALL.md](./docs/INSTALL.md).

### 6.3 Map format

`maps/<site>/v<n>.json`: states, ops, effects, impls, entities, auth,
`compiled_from`, `verified_at`. The field reference is
[docs/spec/map-v0.md](./docs/spec/map-v0.md).

### 6.4 Skills (knowledge)

A generated `portolan-<site>` skill names the ops, mines recipes from traces,
and links the schemas. Skills never execute and are never required. MCP
enforces; skills guide.

---

## 7. Architecture

```
agent / MCP client
        │  MCP (stdio or HTTP)
        ▼
portolan-server          sessions, write safety, audit, MCP surface
        ├── runtime      runUrlOp / runHttpOp / runUiOp, router, extractors
        ├── compiler     segment → parameterize → lift → verify → publish
        ├── substrate    semantic capture, refs, actions, egress, reaper
        ├── model        one ModelPort; offline compile and repair only
        └── skills       recipe mining and skill export
```

**Execution tiers**, in preference order:

| Tier | Path | Writes |
|---|---|---|
| `webmcp` | A tool the page declares | reserved |
| `url` | Navigate a route template | read only |
| `http` | The site's own request, inside the page | write with `outcome_check` |
| `ui` | A semantic UI program | read or write |
| `agent` | The caller's `view`/`act`/`read` fallback | scoped |

**No LLM in the hot path.** A verified op call is deterministic. The model
port is for offline compilation and repair, configured per role
(ADR-003).

**One session, two projections.** The agent sees the map and ops; a human
cockpit can watch the same session later (ADR-007).

---

## 8. Requirements

### P0 — the product

| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Stateful session | Cookies, URL, refs, and map version survive a call |
| R2 | Map model | Schema-validated states, ops, effects, impls |
| R3 | `url` / `http` / `ui` execution | Each tier runs and validates returns |
| R4 | Gates G0/G1/G2 | Passed and recorded in an ADR; **open** (ADR-005) |
| R5 | Compiler | Traces → candidates → verify → publish |
| R6 | Drift repair | Degraded op repaired without duplicate writes |
| R7 | Write safety | Confirmation, idempotency, `unknown_outcome`, audit |
| R8 | MCP surface | Portable tools plus native per-op tools |
| R9 | Skills | Generated skill validates and carries `map_version` |
| R10 | Untrusted labels | Page-derived results labeled; injection fixture |
| R11 | Egress policy | Default deny; blocked requests logged |
| R12 | Session lifecycle | TTL, cap, recovery, orphan reaper |
| R13 | Credentials | Site-scoped; no secrets in maps, traces, logs, skills |

### P1 — release readiness

| ID | Requirement |
|---|---|
| R14 | CLI and config documented with defaults |
| R15 | npm packages and a Docker image with Chromium |
| R16 | Changesets, provenance, GitHub release workflow |
| R17 | Install snippets for five clients |
| R18 | `doctor` diagnoses browser, config, providers, clients |
| R19 | Threat model and write-path review |
| R20 | Runtime coverage ≥80% lines |

### P2 — later

Multi-agent shared sessions, WebMCP passthrough, cross-session cache, vision
fallback, hosted concurrency tiers, the cockpit.

---

## 9. Metrics

**North star:** cost per **completed** task, with steps as the lever.

| Layer | Metric | Target | Status |
|---|---|---|---|
| Steps | ops per intent vs `agent-browser` | ≥3x fewer | G0, unmeasured |
| Cost | $/completed task | ≥5x lower | G0, unmeasured |
| Compiler | share of the oracle win | ≥60% | G1, unmeasured |
| Compiler | yield on held-out traces | ≥50% | G1, unmeasured |
| Drift | auto-repaired ops | ≥80% | G2, unmeasured |
| Drift | duplicate writes | zero | G2, scripted only |
| Speed | p50 `ui` / `url` / `http` | ≤500 / ≤150 / ≤150ms | measured on fixtures |
| Reliability | task success vs baseline | ≥ baseline − 2pts | unmeasured |

**Guardrail:** a cost win that costs more than 2 points of success rate is not
a win.

---

## 10. Gates

The definitions live in [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) and the
current evidence in [docs/G1-G2.md](./docs/G1-G2.md).

| Gate | Question | Pass |
|---|---|---|
| G0 | Do perfect ops beat the best free browser tool? | ≥3x fewer steps and ≥5x cheaper |
| G1 | Do compiled maps keep the win? | ≥60% of oracle, ≥50% yield, K≤3 |
| G2 | Does repair survive drift? | ≥80% repaired, zero duplicate writes |

**Current state (ADR-005):** all three are **not passed**. The harness runs
end to end, but every row is `provider: scripted`; there is no oracle
denominator, no second provider, no real-model failure, and the drift sample
is three ops. The next run must use arms A/B/C/D-oracle, two providers, N=3
with billed usage, oracle rows, and a real drift run including the semantic
filter and paginate failures and an idempotency-key retry.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Compilation is a research risk** (segmentation, parameterization) | High | G1; fallback to human-recorded maps if it misses |
| **G0 fails** — perfect ops don't beat free tools | High | Stop or reframe before the runtime; that is the gate's purpose |
| **Drift** breaks maps silently | High | Canaries, `outcome_check`, drift run, repair loop |
| **Unsafe writes** | High | Effects, confirmation, idempotency, `unknown_outcome`, audit |
| **Prompt injection** via page text | High | Untrusted labels, egress policy, server-enforced writes |
| **ToS exposure** of private endpoints | High | Per-site review before a map ships (T6.04) |
| **Anti-bot divergence** | Medium | Chromium-first substrate; profiles; fallback to `ui` |
| **Cheaper tokens erode the cost pitch** | Medium | Sell steps, reliability, and write safety, not only $/token |
| **Incumbent copies the map model** | Medium | Map library + published numbers + protocol adoption |
| **Stateful integration is harder** | Medium | MCP carries it; `open_site` is one call |

---

## 12. Business model (sketch)

- **Free:** OSS runtime, CLI, MCP server, map spec; unlimited local use.
- **Usage:** per completed task, with a published cost-per-task guarantee.
- **Platform:** concurrency, profiles, audit retention, capability scoping.
- **Never** price per browser-hour. That is the commodity the product escapes.

---

## 13. Phases

| Phase | Deliverable | State |
|---|---|---|
| P1–P3 | Substrate, compiler, verifier, maps | done |
| P4 | Benchmark harness, drift run, ADR-005 | done; gates unpassed |
| P5 | Credentials, egress, injection, lifecycle, observability, CLI, config, packaging, release automation, install, latency, security, coverage | **done** |
| P6 | Vertical choice, design partners, 10 maps | not started (ADR-006 pending) |
| P7 | Docs site, benchmark report, PRD v0.2, licenses, release | in progress |

The schedule and task estimates are in
[docs/PROJECT_PLAN.md](./docs/PROJECT_PLAN.md).

---

## 14. Open questions

1. **Vertical #1 (ADR-006).** Insurance eligibility, procurement, or logistics?
   The decision needs the discovery interviews.
2. **Which provider pairs count for G1.** Two providers are required; the run
   must name them and record billed usage.
3. **Map library ownership.** Human-recorded maps are the G1 fallback; how many
   are acceptable before the compiler is considered failed?
4. **Idempotency across restarts.** The ledger is in memory (#73); a persisted
   ledger is a release requirement for writes.
5. **HTTP authentication.** `serve` has none (#75); a token or socket is needed
   before a non-loopback bind.
6. **Substrate factory in `serve`.** `mcp` now launches a browser; `serve`
   does not (#76).
7. **Name clearance.** Trademark classes 9/42 (T7.06).

---

## Appendix A — MCP and error reference

Tool surface: `open_site`, `call`, `view`, `act`, `read`, `fallback_done`.

Error codes: `invalid_request`, `invalid_params`, `precondition_failed`,
`needs_auth`, `needs_confirmation`, `unknown_op`, `op_broken`,
`unknown_outcome`, `blocked`, `timeout`, `stale_ref`, `not_interactive`,
`map_not_found`, `session_not_found`, `internal`.

Effects: `read`, `write`, `irreversible`.

Post-checks: `url`, `state`, `exists`, `absent`, `text`.

## Appendix B — Naming

**Portolan** (renamed from Facet on 2026-11-08, ADR-004) — portolan charts were
medieval sea charts drawn from the logbooks of sailors who had already made
the voyage. The product: site maps compiled from the runs of agents that came
before, so the next agent calls known routes instead of looking at screens.

Facet was dropped for collisions with Facets Cloud, an existing FACET MCP
server, a wealth-management brand, and crowded search results.

## Appendix C — What changed from v0.1

| v0.1 | v0.2 |
|---|---|
| "A stateful browser that synthesizes a temporary API" | A site-map runtime; the browser is the substrate (ADR-002) |
| Five HTTP verbs (`goto`, `act`, `read`, `view`, `sleep`) | MCP tools (`open_site`, `call`, `view`, `act`, `read`) over a map |
| Affordances, effects, deltas as the product | The fallback path; the product is typed ops |
| Token-per-observation goals | Steps and cost-per-task; tokens are a secondary metric |
| Launch gate: 5x cost, 20 tasks | G0, G1, G2 as defined in BUILD_PLAN; ADR-005 keeps them open |
| Stateless compatibility as the adoption story | MCP is the integration; the session is server-side |
| Open question: protocol carrier | Answered: MCP for execution, Skills for knowledge (ADR-003) |
| Open question: open source? | Answered: Apache-2.0 runtime, MIT cockpit, CC-BY spec (ADR-008) |
| No vertical | ADR-006 pending; Phase 6 owns it |
