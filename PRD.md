# Portolan — Product Requirements Document

> **Superseded in part by ADR-002 (2026-11-08).** The product is now a **site-map runtime**: agents call typed operations from a verified map of each site, instead of reading affordances step by step. This PRD's one-liner still holds. Its verbs (§6), architecture (§7), requirements (§8), metrics (§9) and gates (§10) describe what is now the **substrate** (`docs/SUBSTRATE.md`). The current plan, gates and metrics are in `docs/BUILD_PLAN.md`. A PRD v0.2 rewrite is pending.

| | |
|---|---|
| **Product** | Portolan |
| **Version** | 0.1 (draft for validation) |
| **Date** | 2026-11-08 |
| **Owner** | Abubakar Siddik |
| **Status** | Pre-build. Every quantitative claim below marked **[H]** is a hypothesis to be validated by the benchmark in §10. |
| **One-liner** | A stateful browser that synthesizes a temporary API for any website and talks to agents in affordances, effects, and deltas — so a web task costs cents, not dollars. |

---

## 1. Problem

Agents drive the web through interfaces built for humans. Three specific failures follow.

**1.1 Agents receive documents, not capabilities.**
The dominant pattern is: serialize the DOM or a screenshot, hand it to the model, and hope it infers what is clickable. Raw HTML for a typical commerce page runs 50k–400k tokens. Screenshots cost ~1.5k tokens each and force multi-step visual reasoning. Neither is an interface; both are a Rorschach test.

**1.2 Context accumulates, so cost grows quadratically.**
Naive agents re-send the entire conversation — system prompt, every prior snapshot, every prior action — on each step. A 30-step task at ~15k tokens per observation bills roughly 30 × 15k ≈ 450k input tokens **[H]**. Step 30 costs far more than step 1, and nothing about the task got harder.

Published cost teardowns of `browser-use` tasks report that **~93% of per-task spend is input tokens**, not browser compute. The bottleneck is what we send to the model, not what we run.

**1.3 Browser compute is already priced as a commodity.**
Hosted browsers sell for **$0.02–$0.10 per browser-hour** (Browser Use, Steel, Browserbase). A 10x cheaper engine therefore saves the customer roughly $0.018/hour — a rounding error against a $1–$4 model bill for the same task. Efficiency at the engine layer is necessary but has almost no willingness-to-pay.

**The gap:** nobody sells a *cheap interaction model*. Everyone sells transport.

---

## 2. Insight / Thesis

> Move state out of the conversation and into the browser.

Today the browser is a function: `observe() → dump`. Portolan makes the browser a **stateful actor**: the agent holds a session handle and a set of element references; the browser holds the page, history, DOM, and network. Steps become stateless. O(n²) collapses to O(n).

Two primitives follow from that:

- **Affordances over observables.** The agent asks "what can I do here?" and receives a ranked, typed, budgeted action list — not a document.
- **Effects over pixels.** After an action, report structural consequences — *modal opened*, *navigated*, *3 requests pending* — so the agent decides correctly in one turn. Fewer steps beats smaller steps, because steps multiply everything.

**Framing:** Portolan is a browser that **synthesizes a temporary API for any website at runtime, without the site's cooperation.** Chrome-in-a-trench-coat gives the agent a document. WebMCP gives it a real API that the site must build. Portolan occupies the space between.

---

## 3. Goals & Non-Goals

### Goals

| ID | Goal | Measure |
|---|---|---|
| G1 | Reduce tokens per observation by an order of magnitude | p50 ≤ 800 tokens per `affordances` call vs ~6–15k for an A11y snapshot **[H]** |
| G2 | Cut cost per completed task 5x | ≥5x lower $/task vs `browser-use` baseline on the 20-task suite (§10) **[H]** |
| G3 | Preserve full browser fidelity | ≥98% of benchmark tasks reachable without a manual fallback |
| G4 | Make idle time free | Hibernation frees ≥95% of session RSS; wake ≤50ms p50 |
| G5 | Make cost observable | Every response carries `{tokens, ms, mb}` |
| G6 | Cut retries | ≤1.2 average actions per intended action on the benchmark **[H]** |

### Non-Goals (v1)

- Writing a rendering engine. We rent engines; we own the interface.
- A human-facing browser UI.
- A search engine or a bulk crawl platform.
- Beating Chromium on standards conformance.
- Consumer distribution.

---

## 4. Users

**Primary — Agent platform engineers.** Teams running autonomous web workflows (support ops, procurement, research) who see a monthly bill and a flaky success rate. They own the pager. They will adopt a session model if it halves their bill.

**Secondary — Vertical AI SaaS teams.** Building a product where web interaction is the bottleneck (insurance eligibility, invoice reconciliation, travel rebooking). They buy outcomes, not browsers.

**Tertiary — OSS agent developers.** Adopt the protocol and the MCP server; become the distribution channel.

**Anti-persona —** humans browsing; petabyte-scale scrapers; teams with <$500/month web-automation spend (they will never buy infrastructure).

### Jobs to be done

- "When my agent needs to complete a task on a site with no API, I want it to succeed in fewer steps and fewer dollars, so my unit economics work."
- "When my agent fails halfway through a checkout, I want to resume exactly where it left off instead of restarting, so I stop paying twice."
- "When finance asks why agent costs are what they are, I want a per-task meter, so I can defend or fix it."

---

## 5. Competitive Position

| Alternative | What it gives you | Where it falls short |
|---|---|---|
| Chrome + CDP (Browserbase, Steel, Browser Use Cloud) | Real browser, any site | Document-shaped output; O(n²) context; priced per hour |
| browser-use / Stagehand | Agent loop over a real browser | State lives in the conversation; no delta model; retries |
| Lightpanda | 10x cheaper engine | Engine only; no interaction model |
| Firecrawl / Exa / Jina | Excellent read/scrape | Read-only; no interaction, no session state |
| WebMCP | Sites expose typed tools | Requires site cooperation; years from coverage |
| Portolan | Typed affordances + effects + deltas + hibernation + engine-agnostic | New session model to adopt; JS fidelity bounded by engine |

**Positioning statement:** For teams whose agents must *act* on the open web, Portolan is a stateful browser that exposes each site as a temporary, typed API, costing 5x less per completed task than document-based browsing — because it holds the page state so the agent doesn't have to.

**Moat (honest):** thin at launch. The durable assets are (a) the protocol as a de facto interface, (b) an eval suite that proves cost-per-task, and (c) the affordance/effect model's quality bar. Not compute.

---

## 6. Product: The Five Verbs

The entire product surface. Everything else is implementation.

```jsonc
// 1. Create a session
POST /v1/sessions
  { profile?: "default", viewport?: [1280,800], block?: ["media","ads"] }
→ { sid: "s_7f3", ready: true }

// 2. Navigate
POST /v1/s/{sid}/goto
  { url: "https://example.com/product", budget: 800 }
→ { v: 1, title: "…", url: "…", ready: true,
    affordances: [{ ref:"e12", do:"click", label:"Add to cart", kind:"primary" }],
    reading_ref: "m1", tokens: 412 }

// 3. Act — browser resolves, agent declares
POST /v1/s/{sid}/act
  { ref: "e12", do: "click" }
→ { v: 2, ok: true,
    effects: [{ type:"modal", label:"Confirm size" }],
    delta:   [{ ref:"e51", do:"click", label:"Confirm", kind:"primary" }],
    tokens: 61 }

// 4. Read — explicit, separate from acting
GET /v1/s/{sid}/read?ref=m1&budget=1500
→ { markdown: "…", truncated: false, tokens: 1204 }

// 5. Hibernate / wake
POST /v1/s/{sid}/sleep            → { snapshot:"sn_9f2", freed_mb: 288 }
POST /v1/sessions/wake { snapshot:"sn_9f2" } → { sid:"s_7f3", v:2, ready:true, ms:14 }
```

### Design rules (P0, non-negotiable)

1. **Affordances are ranked and budgeted.** Interactive → visible → changed. Truncate to `budget`; report what was dropped (`omitted: 14`) rather than silently trimming.
2. **Refs are stable.** `ref = hash(role, accessible_name, ordinal)` within a document version. A ref survives re-render; if it cannot, return `stale: true` and the new ref.
3. **Deltas are the default return type** for every mutation. Full snapshots are opt-in.
4. **Effects describe structure, not pixels.** `nav | modal | menu | validation | toast | download | dialog | network_pending`.
5. **The browser owns timing.** `act` performs scroll-into-view, hit-test, quiescence wait, and one retry. Agents never sleep.
6. **Errors are typed.** `stale_ref | not_interactive | blocked | needs_auth | captcha | timeout | engine_crash` — each with a suggested recovery.
7. **Every response carries the meter:** `tokens`, `ms`, `mb`.

---

## 7. Architecture

```
agent ──JSON-RPC/HTTP──▶ portolan-server
                          ├── session manager      create/fork/sleep/wake, snapshot store
                          ├── semantic engine      affordance extraction, ref graph, ranking
                          ├── delta engine         structural diff, effect classification
                          ├── policy               egress allowlist, scoped creds, artifacts
                          ├── escalation ladder    static fetch → DOM-only → full engine
                          ├── meter                tokens / ms / mb per call
                          └── engine adapter       CDP: chromium | lightpanda | webkit
```

**Engine adapter is four methods:** `navigate`, `snapshot`, `dispatch_input`, `evaluate`. Anything that implements it is a Portolan engine. This is what keeps us from marrying Chromium and what lets us ride Lightpanda's cost curve down without a rewrite.

**Escalation ladder:**

| Tier | When | Cost |
|---|---|---|
| 0 — fetch + readability | Read-only intent, no JS needed | ~5ms, ~1k tokens |
| 1 — DOM-only engine | JS required, no pixels needed | ~80ms |
| 2 — full engine via CDP | Tier 1 returns empty/blocked, or interaction needs it | ~600ms |

Escalate on: empty semantic model after quiescence, challenge detected, or explicit `require: "full"`. Cache the tier decision per domain.

---

## 8. Requirements

### P0 — the demo (weeks 1–4)

| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Session lifecycle: create, goto, sleep, wake | Wake restores cookies, URL, DOM, and refs; ≤50ms p50 |
| R2 | Affordance extraction with stable refs | ≥95% of interactive elements on the 20-task suite correctly identified |
| R3 | `act` with resolution + effect detection | Click/type/select/scroll/key/upload; ≤1.2 actions per intent |
| R4 | Delta engine | Post-action payload ≤15% of a full affordance snapshot |
| R5 | `read` → markdown | Nav/ads/footers stripped; no duplicate content |
| R6 | Token budget + omission reporting | Never exceeds `budget`; always reports what was dropped |
| R7 | Cost meter | `{tokens, ms, mb}` on every response, reproducible |
| R8 | Escalation ladder | Auto-selects tier; domain decision cached |
| R9 | Profile persistence | Cookies/localStorage/session survive across sessions |
| R10 | Artifacts by ref | Download/upload/PDF handled without entering the token path |
| R11 | Ad/tracker blocking on by default | ≥30% median page-weight reduction |

### P1 — the product (weeks 5–10)

| ID | Requirement |
|---|---|
| R12 | Fork from warm base — per-session marginal cost near zero |
| R13 | Multi-document (tabs), back/forward without reload |
| R14 | Typed error taxonomy with recovery hints |
| R15 | MCP server wrapper (`portolan mcp`) |
| R16 | Lightpanda adapter behind the same protocol |
| R17 | Replayable audit log of every action and every byte observed |
| R18 | Capability scoping: per-session egress allowlist, scoped credentials |

### P2 — the platform

| ID | Requirement |
|---|---|
| R19 | Multi-agent shared session with isolation and handoff |
| R20 | WebMCP passthrough (use site-declared tools when present) |
| R21 | Cross-session semantic cache keyed by URL + state |
| R22 | Vision fallback — pixels only when semantics fail |
| R23 | Hosted cloud with concurrency tiers |

---

## 9. Metrics

**North star:** cost per **completed** task (cents). Not browser-hours. Not tokens. Completed tasks.

| Layer | Metric | Target |
|---|---|---|
| Cost | $/completed task | ≥5x better than baseline **[H]** |
| Cost | tokens/observation | p50 ≤800, p95 ≤2500 |
| Efficiency | steps/task | ≤ baseline − 30% |
| Quality | task success rate | ≥ baseline − 2pts (currently ~89% on WebVoyager) |
| Speed | goto→ready p50 | ≤900ms |
| Infra | session RSS, hibernated | ≤5% of live |
| Reliability | actions per intent | ≤1.2 |

**Guardrail:** any cost win that costs more than 2 points of success rate is not a win. Cheapness is a constraint, not the product.

---

## 10. Launch Gates

Ship the demo only if all four hold:

1. **20 real tasks** (not benchmarks): checkout, form fill, dashboard read, multi-page research, auth-gated flow. Each run against baseline (`browser-use` + Playwright) and Portolan.
2. **≥5x reduction in $/completed task**, with the meter's arithmetic reproducible by hand.
3. **Success rate ≥ baseline − 2pts.**
4. **Three design partners** have run their own tasks through it and asked when they can have access.

If the result is 1.5x, we have a feature incumbents ship in a quarter — and we stop.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Token price deflation** erodes the savings pitch (~10x/year) | High | Sell on latency, accuracy, and step count too — not only $/token. Cost per task still falls slower than token price because steps dominate. |
| **JS fidelity** — cheap engines break on SPAs | High | Escalation ladder; per-domain tier cache; never promise a single engine |
| **Incumbent copies the delta model** | High | Protocol adoption + public cost benchmark; ship the eval suite as the moat |
| **Stateful session is a harder integration** than a function call | Medium | Stateless compatibility mode (`session: "ephemeral"`) for the first call; MCP wrapper |
| **Anti-bot divergence** on non-Chromium engines | Medium | Egress proxy, per-tier profile pinning; fall back to Tier 2 |
| **Prompt injection** via page content | High | Treat all page text as untrusted; policy layer restricts egress and credentials; never let affordance labels carry instructions |
| **Category revenue is small** (leader ≈ $3.6M) | High | Price per completed task, move up into vertical outcomes |

---

## 12. Business Model (sketch)

- **Free:** OSS protocol + local `portolan-server`, unlimited, no support.
- **Usage:** per completed task, with a published cost-per-task guarantee ("or we refund the delta").
- **Platform:** concurrency tiers, profiles, audit log, capability scoping.
- **Never** price per browser-hour. That is the commodity we are escaping.

---

## 13. Phases

| Phase | Dates | Deliverable | Gate |
|---|---|---|---|
| P0 — Instrument | Week 1 | Protocol skeleton + cost meter + 20-task harness | Meter reproducible |
| P1 — Semantics | Week 2 | Affordances, refs, effects, budgets | ≥95% element coverage |
| P2 — Deltas | Week 3 | Delta engine + hibernation | ≤15% delta payload; wake ≤50ms |
| P3 — Ladder | Week 4 | Tier 0/1/2 escalation | 3 partners onboarded |
| P4 — Engines | Weeks 5–6 | Lightpanda adapter, fork-from-warm | Same protocol, lower floor |

---

## 14. Open Questions

1. **Stateful vs stateless default.** Stateful wins the cost argument; stateless wins adoption. Do we default to stateful and offer ephemeral, or the reverse?
2. **Protocol carrier.** HTTP/JSON, JSON-RPC over stdio, or MCP-first? MCP maximizes reach; HTTP maximizes performance.
3. **Ref stability contract.** How much re-render churn can a ref survive before we require re-observation?
4. **Do we open-source `portolan-server`?** Adoption vs. defensibility. Leaning open protocol, hosted runtime.
5. **Vertical #1.** Which workflow do we use to prove outcomes — support ops, procurement, or insurance eligibility?
6. **Name clearance.** "Portolan" conflicts with a wealth-management brand; verify trademark in class 9/42.

---

## Appendix A — Protocol reference

| Verb | Method | Returns |
|---|---|---|
| `sessions.create` | POST `/v1/sessions` | `sid` |
| `goto` | POST `/v1/s/{sid}/goto` | `v`, `affordances`, `reading_ref` |
| `act` | POST `/v1/s/{sid}/act` | `v`, `effects`, `delta` |
| `read` | GET `/v1/s/{sid}/read` | `markdown` |
| `view` | GET `/v1/s/{sid}/view?since=v` | `delta` |
| `back` / `forward` | POST `/v1/s/{sid}/history` | `v`, `affordances` |
| `sleep` | POST `/v1/s/{sid}/sleep` | `snapshot` |
| `wake` | POST `/v1/sessions/wake` | `sid`, `v` |

### Action verbs
`click`, `type`, `clear`, `select`, `check`, `scroll`, `key`, `hover`, `upload`, `download`, `wait_for`.

### Effect types
`nav`, `modal`, `menu`, `validation`, `toast`, `dialog`, `download`, `network_pending`, `dom_only`.

### Error codes
`stale_ref`, `not_interactive`, `blocked`, `needs_auth`, `captcha`, `timeout`, `engine_crash`, `budget_exceeded`.

---

## Appendix B — Naming

**Portolan** (renamed from Facet on 2026-11-08, ADR-004) — portolan charts were medieval sea charts drawn from the logbooks of sailors who had already made the voyage, used to navigate by chart instead of by sight. That is the product: site maps compiled from the runs of agents that came before, so the next agent calls known routes instead of looking at screens.

Facet was dropped because of Facets Cloud (an AI-agents + MCP platform for the same buyer), an existing FACET MCP server, a wealth-management brand, and crowded developer search results.

Rejected: Quay (Red Hat's registry), Tether (USDT), Pith (reads as "pithy"), Gantry (existing ML brand), Mullion (unspellable).
