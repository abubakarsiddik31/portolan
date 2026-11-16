# Portolan — Research & Analysis

**Date:** 2026-11-08
**Purpose:** Record the market evidence and the reasoning used to decide whether "a browser for agents that is cheap to run and token-efficient" is worth building, and what shape it should take.

Every figure is as-reported by the cited source at the time of research. Figures marked **[est]** are third-party estimates, not audited. Figures marked **[H]** are our hypotheses, not evidence.

---

## 1. Executive summary

**Verdict: not worth building as originally stated. Worth building in a reframed form.**

The original thesis — *a browser for agents that is cheaper to run* — fails on three falsifiable claims:

| Claim | Evidence | Result |
|---|---|---|
| Agent browsing is expensive to run | Hosted browsers sell for **$0.02–$0.10 per browser-hour** | False at the margin |
| Browser compute dominates agent cost | **~93% of per-task spend is input tokens**, not compute | False, decisively |
| A cheaper engine is a durable advantage | Lightpanda is free, open source, Zig-based, ~10x lighter — and has raised only **$4.5M** | Already commoditized |

What survived is an **interaction-model** thesis, not a compute thesis:

> The browser should hold the state; the agent should hold only a handle. Then agents receive affordances, effects, and deltas instead of documents — the observation term shrinks ~40x, and cost per completed task falls by a smaller factor that the benchmark must measure (target ≥5x).

That reframing attacks the 93% (tokens and steps) instead of the 7% (compute), which is the only place a new entrant can win.

---

## 2. Method

Desk research across vendor sites, pricing pages, funding announcements, benchmark leaderboards, and independent cost teardowns. Queries were run on 2026-11-08 across five clusters:

1. Agent-native browser engines and frameworks
2. Hosted browser infrastructure: funding, pricing, customer counts
3. Cost structure of agent web tasks
4. Agent reliability benchmarks
5. Adjacent standards and read-layer vendors

Nothing was validated by primary interview. **All of this is a prior, not a conclusion.** The benchmark in PRD §10 exists to replace it with measurement.

---

## 3. Market evidence

### 3.1 Category funding and pricing

| Company | Position | Capital | Pricing / scale signal |
|---|---|---|---|
| **Browserbase** | Hosted Chrome + Stagehand SDK | **$40M Series B @ ~$300M** (Jun 2025, Notable Capital) | 1,000+ customers; **~$3.6M revenue [est]**; plans $20 / $99 / custom; ~$0.10/browser-hr |
| **Browser Use** | Largest OSS browser agent + cloud | **$17M seed** (Mar 2025, Felicis) | **$0.02/browser-hr**, $5/GB residential proxy; concurrency tied to cumulative spend |
| **Steel.dev** | Hosted browser API | **$17M** (2025) | $0.08/browser-hr, $1/1k CAPTCHAs, $6/GB proxies; $30 free credits |
| **Lightpanda** | New engine from scratch (Zig) | **$4.5M pre-seed** | Open source, free; ~13k GitHub stars; partial CDP/V8 coverage |
| **Firecrawl** | Read/scrape layer for AI | **$75M Series B** (Sept 2026) | Read-first; heavy funding in the *reading* layer |
| **Exa** | Embedding-based search API for AI | Funded | Search + clean content in one call |
| **Jina AI** | Reader / embeddings / reranker | Funded | Reader ~$0.05/1M tokens; free tier at 20 rpm |

**The most important line in this table is Browserbase's revenue.** The best-funded, best-positioned player in the category, three years in, with 1,000+ customers, is at single-digit millions **[est]**. That implies roughly **$3.6k revenue per customer per year**.

That is the unit economics of selling browser transport. It is not a failure of execution. The input (Chromium) is free and the output is metered like electricity, so price collapses toward zero and the vendor captures almost nothing per seat.

### 3.2 Demand signals (positive)

- Browser Use's open-source library is one of the most-starred agent projects in existence (six-figure stars across Python/TS), indicating genuine developer pull for "make an agent drive a browser."
- Firecrawl raised $75M in Sept 2026 for *reading* the web for AI — capital is flowing to whoever reduces the cost of getting web content into a model, not to whoever runs Chrome.
- Agentic-AI market estimates cluster at **$7–11B in 2026** with **~40–47% CAGR** (Grand View, Precedence, MarketsandMarkets, Fortune Business Insights). Directionally real; precision is poor.
- Hosted browser concurrency tiers (50 sessions for a $100 top-up) show workload fan-out is growing, which is where memory cost eventually matters.

### 3.3 Demand signals (negative)

- **OpenAI sunset ChatGPT Atlas on 2026-08-09, 292 days after launch**, folding browsing into a desktop app and a Chrome extension. If the most distributed AI company on earth could not retain users on an agentic browser surface, the consumer version of this thesis is dead.
- Consumer "agentic browsers" (Atlas, Comet, Dia) are browsers *for humans with an agent attached* — the opposite architecture from what Portolan proposes, and the one that just failed.
- Perplexity Comet has not published meaningful user counts; the category's consumer metrics are opaque, which usually means unflattering.

### 3.4 Market-sizing caveat — do not build a plan on these

The analyst numbers for "AI browser market" are mutually irreconcilable:

- One report: **$1.42B (2025) → $3.08B (2034), 9.0% CAGR**
- Another: **$76.8B by 2034, 32.8% CAGR**

A **~25x disagreement** in the same category means nobody has a model. Treat all AI-browser TAM figures as noise. The credible number in this space is Browserbase's revenue, because it is a bank deposit rather than a projection.

---

## 4. Cost model: where the money actually goes

### 4.1 Compute is the small term

Hosted browser at **$0.02/hr** (Browser Use). A 10x more memory-efficient engine saves approximately **$0.018 per browser-hour**.

At 100,000 browser-hours/month — a large deployment — that is **$1,800/month saved**. That is the entire addressable value of the "cheaper browser" thesis at meaningful scale. No platform team reorganizes around $1,800.

### 4.2 Tokens are the large term

An independent, reproducible teardown of `browser-use` per-task cost reports:

> **~93% of task cost is input tokens** — screenshots and DOM dumps — not browser time.

This single finding reframes the entire product. The customer's bill is dominated by what the agent *reads*, not by what the machine *runs*.

### 4.3 Observation size (the real mechanism)

Approximate observation tokens for a 30-step task **[H]**, counting only the current page state sent at each step:

| Approach | Observation tokens / step | × 30 steps | Cost @ $3/M |
|---|---|---|---|
| Raw HTML + screenshot | ~15,000 | ~450,000 | ~$1.35 |
| Accessibility tree, full each step | ~6,000 | ~180,000 | ~$0.54 |
| **Affordances + deltas, state in browser** | **~300** | **~9,000** | **~$0.03** |

That is roughly **40x on the observation term**. Three corrections to how this was first stated:

1. **The table is linear.** Each total is per-step size × 30. The 40x comes entirely from smaller observations, not from removing history.
2. **History belongs to the harness, not the browser.** If the agent loop keeps every prior tool result, cost grows quadratically for every approach, including Portolan; deltas shrink the constant, not the exponent. Portolan can't force a caller to drop history. What statefulness buys is the small observation itself: deltas and short stable refs need a server-held "before."
3. **The whole-task ratio is lower than 40x.** Every step also pays for the system prompt, tool schemas, goal, action log, and output tokens (priced ~5x input), and prompt caching discounts re-sent prefixes. None of that shrinks with Portolan. The realistic whole-task ratio is unknown until measured; `BUILD_PLAN.md` §9.0 measures the ceiling on Day 1 before any Portolan code is written.

### 4.4 The three levers

```
cost = steps × tokens_per_step × token_price  +  browser_minutes × $/min
```

- **Compute work** attacks the last term: ~7% of spend.
- **Interaction model** attacks the first two: ~93% of spend.

Portolan attacks the first two. Compute efficiency is a hygiene requirement, not the product.

---

## 5. Competitive landscape

| Alternative | What it provides | Structural gap |
|---|---|---|
| Chrome + CDP (Browserbase, Steel, Browser Use Cloud) | Real browser on any site | Document-shaped output; O(n²) context; priced per hour |
| browser-use / Stagehand | Agent loop over a real browser | State in the conversation; no delta model; retry-heavy |
| Lightpanda | 10x cheaper engine | Engine only; no interaction model; incomplete JS |
| Firecrawl / Exa / Jina | Excellent read/scrape | Read-only; no session, no interaction |
| Playwright MCP / Vercel agent-browser | A11y-tree snapshots, refs | Snapshot-per-step; no effects; no hibernation |
| WebMCP (W3C draft, Google + Microsoft) | Sites expose typed tools | Requires site cooperation; years from coverage |
| WALT (Salesforce, ICLR 2026), SkillWeaver (OSU/CMU) | Research: compile site functionality into callable tools/APIs | No serving runtime, write safety, or drift handling |
| Integuru, Parse | Site → typed API from network traffic; Parse serves it over MCP with repair | Network-layer; writes unsafe without client logic; no state model |
| Notte Functions, workflow-use, Airtop, Komos | Record or describe a task → deterministic workflow/endpoint, agent fallback | One task → one script; no shared map |
| Stagehand caching | Cached selectors per action, LLM fallback | Action-level; agent still takes every step |
| **Portolan (v4)** | Site map: states + typed ops + effects; tiered execution; compiled, verified, repaired | Crowded technique; must win on state model, write safety, drift numbers, and a vertical library |

### 5.1 Moat assessment — honest

There is **no moat today**: no network effects, no switching costs (CDP is open), no scale economies (it is a price war), no counter-positioning. The only plausible sources are:

- **Cornered resource** — an engine nobody can replicate. Expensive, and Lightpanda already occupies it for free.
- **Process power** — a semantic/affordance model measurably better than everyone's. This is an evals-and-product problem, which is where the defensibility actually is.

Thin for an infrastructure company. Reasonable for a product company with a published benchmark.

**Update after v4 (ADR-002).** A library of **verified site maps** for one vertical is a better candidate than either: it compounds with use (every run and every repair improves it), it is costly to rebuild, and its quality is measurable (op success, drift survival, repair time). The compilation technique itself is not a moat; WALT and SkillWeaver publish it.

### 5.2 The standards threat

WebMCP is a **W3C draft authored by Google and Microsoft**, with a Chrome implementation behind a flag. If sites declare their own tools, runtime synthesis becomes less necessary. Do not fight this — **support it as a fast path** (PRD R20). A startup cannot win a standards war; it can ride one.

---

## 6. Reasoning trail

The thesis changed four times. Recording this matters, because the discarded versions are the ones a new team will drift back toward.

### v1 — "A browser engine built for agents, cheaper to run"
**Killed by:** commodity pricing ($0.02/hr), token-dominated cost (93%), and Lightpanda occupying the exact position for free with $4.5M raised.

### v2 — "A routing ladder: fetch → DOM-only → full browser"
**Partially true, insufficient as a product.** The insight is correct (most agent traffic is read-only and needs no browser), but Tier 0 is already a crowded, well-funded category (Firecrawl $75M, Exa, Jina). The ladder is a *feature* of the chosen product, not the product.

### v3 — "A stateful browser that synthesizes a temporary API for any site"
**Survived the market test, then drifted in planning.** It sits in the unoccupied space between Chrome-in-a-trench-coat (gives a document) and WebMCP (requires site cooperation), and it attacks the 93% rather than the 7%. But the v1 build plan implemented it as compact affordances and deltas per step. The adversarial review (`docs/archive/BUILD_PLAN_v1.md` §15) found that saves tokens per step, which free tools (`agent-browser`, Playwright MCP) already do; the estimate was ~1.15x over them.

### v4 — "A site-map runtime: agents call typed operations, not screens"
**Current thesis (ADR-002).** This is what v3's one-liner meant. Each site is served as a map of states and typed operations, executed through the cheapest verified tier, compiled from runs, and repaired on drift. It cuts **steps**, which neither free snapshot tools nor falling token prices erase. The pattern is crowded (§5), so the bet is narrower: state model, write safety, published verification/drift numbers, and one vertical's map library. `docs/BUILD_PLAN.md` gates it on Day 2 with hand-written ops before any compiler is built.

---

## 7. Rejected paths and why

| Path | Why rejected |
|---|---|
| **Write a rendering engine (Zig/Rust)** | 2–3 years of compiler and JS-runtime work to save a line item worth ~7% of the customer's bill. Lightpanda is free and ahead. |
| **Sell browser-hours** | Price is already $0.02–$0.10 and collapsing. Leader's revenue implies ~$3.6k/customer/year. |
| **Consumer agentic browser** | Atlas died in 292 days. Distribution is unwinnable against OpenAI/Google/Perplexity. |
| **Standards play (WebMCP-alike)** | Authored by Google + Microsoft. Support it, don't compete with it. |
| **Bulk scraping / crawl platform** | Firecrawl ($75M) and Exa own it; low differentiation; commodity margin. |
| **Pure read layer (Tier 0 only)** | Crowded and well-funded; no session state; no interaction; easy to copy. |
| **Vision-first (screenshots)** | ~1.5k tokens per frame, forces multi-step visual reasoning, and is a major contributor to the 93%. |

---

## 8. Assumptions and falsification

### What must be true for Portolan to be a company

0. **(v4)** Perfect hand-written ops cut steps ≥3x and cost ≥5x vs the best free tool; compiled maps reach ≥60% of that; drift is repaired automatically ≥80% of the time with zero duplicate writes. **[H]** Gates G0–G2 in `BUILD_PLAN.md`.
1. Cost per **completed** task can improve ≥5x on real workloads, not benchmarks. **[H]**
2. Success rate holds within 2 points of baseline while doing so. **[H]**
3. The semantic/affordance layer generalizes across long-tail sites without per-site work. **[H]**
4. Buyers will adopt a session model rather than a function call. **[H]**
5. Somebody's monthly web-automation bill is large enough to care (≥$500/mo). **[H]**

### Kill criteria

Stop if any of these hold after the benchmark:

- Cost per task improves **<2x** on real workloads.
- A `readability` call plus prompt tuning gets **within 20%** of the result.
- Target customers' total browser spend is **under ~$500/month** — they will never buy infrastructure.
- The buyer cannot be named. "Developers building agents" is not a buyer; a platform team with a monthly invoice is.
- Success rate drops more than 2 points.

### What would change the plan

- **Lightpanda reaches full JS fidelity** → shift further up-stack; the engine gap closes entirely and the interaction model becomes the only product.
- **WebMCP ships broadly** → pivot the semantic layer into a WebMCP-aware router that still handles the ~90% of sites that never adopt it.
- **Token prices fall faster than step counts** → the $ argument weakens; lead with latency, reliability, and step count instead.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Token price deflation (~10x/yr) erodes the savings pitch | High | Sell on latency, accuracy, and step count too; steps fall slower than token prices |
| JS fidelity — cheap engines break on SPAs | High | Escalation ladder; per-domain tier cache; never promise one engine |
| Incumbents copy deltas/affordances | High | Publish the benchmark; make the protocol the interface; ship evals as the moat |
| Stateful session is a harder integration | Medium | `ephemeral` compatibility mode; MCP wrapper for reach |
| Anti-bot fingerprint divergence on non-Chromium engines | Medium | Egress proxy; per-tier profile pinning; fall back to Tier 2 |
| Prompt injection via page content | High | Treat all page text as untrusted data; policy layer restricts egress + credentials; affordance labels never carry instructions |
| Category revenue is genuinely small today | High | Price per completed task; move up into vertical outcomes where ACV is 100x |

---

## 10. Open questions

1. **Stateful vs stateless default.** Cost argument favours stateful; adoption favours stateless. Lean: stateful default + ephemeral mode.
2. **Protocol carrier.** HTTP/JSON vs MCP-first. Lean: HTTP core, MCP wrapper.
3. **Ref stability contract.** How much churn before mandatory re-observation?
4. **Open-source `portolan-server` or not?** Lean: open protocol, hosted runtime.
5. **First vertical.** Support ops vs procurement vs insurance eligibility.
6. **Trademark clearance** for "Portolan" in classes 9/42 (renamed from Facet; see ADR-004).

---

## 11. Sources

Retrieved 2026-11-08. Prices and funding change; re-verify before citing externally.

**Browser infrastructure**
- Browserbase — Series B, $40M @ ~$300M: https://www.browserbase.com/blog/series-b-and-beyond
- Browserbase pricing: https://www.browserbase.com/pricing
- Browserbase revenue estimate (~$3.6M): https://getlatka.com/companies/browserbase.com
- Steel pricing ($0.08/hr, proxies, CAPTCHA): https://docs.steel.dev/overview/pricinglimits
- Browser Use cloud pricing ($0.02/hr): https://browser-use.com/pricing
- Browser Use concurrency tiers: https://docs.browser-use.com/cloud/guides/concurrency
- Browser Use $17M seed: https://browser-use.com/posts/seed-round

**Engines and frameworks**
- Lightpanda: https://lightpanda.io/
- Lightpanda repo: https://github.com/lightpanda-io/browser
- Lightpanda $4.5M pre-seed: https://lightpanda.io/blog/posts/lightpanda-raises-preseed
- Vercel agent-browser: https://agent-browser.dev/
- Vercel agent-browser repo: https://github.com/vercel-labs/agent-browser
- browser-use repo: https://github.com/browser-use/browser-use
- Stagehand: https://www.browserbase.com/stagehand
- Playwright MCP: https://playwright.dev/docs/getting-started-mcp
- Notte: https://www.notte.cc/

**Cost structure**
- Per-task cost teardown, 93% input tokens: https://github.com/cdywolf/browser-use-cost-teardown

**Reliability benchmarks**
- WebVoyager ~89.1% for browser-use (secondary reporting): https://baeseokjae.github.io/posts/ai-browser-agents-comparison-2026/
- BrowseComp leaderboard: https://leaderboard.steel.dev/leaderboards/browsecomp/

**Adjacent / read layer**
- Firecrawl $75M Series B: https://www.finsmes.com/2026/09/firecrawl-raises-75m-in-series-b-funding.html
- Exa: https://exa.ai/
- Jina Reader: https://jina.ai/reader/
- Jina pricing: https://www.usagepricing.com/blueprint/jina-ai

**Site-to-API and tool learning (v4)**
- WALT (ICLR 2026): https://iclr.cc/virtual/2026/poster/10008481 · https://github.com/SalesforceAIResearch/WALT
- SkillWeaver: https://osu-nlp-group.github.io/SkillWeaver · https://huggingface.co/papers/2504.07079
- Integuru: https://hn.svelte.dev/item/41983409
- Parse: https://docs.parse.bot
- Notte Functions: https://www.notte.cc/blog/notte-functions
- browser-use workflow-use: https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md
- Stagehand caching: https://docs.stagehand.dev/v4/best-practices/caching
- API Anything: https://hoangyell.com/api-anything-explained/

**Standards**
- WebMCP: https://www.webmcp.md/
- WebMCP status, July 2026: https://www.spronta.com/blog/state-of-webmcp-july-2026/
- WebMCP technical notes (W3C CG): https://w3c-cg.github.io/aikr/webMCP/webmcp-technical-notes.html

**Negative signals**
- Atlas shutdown (2026-08-09), TechCrunch: https://techcrunch.com/2026/07/09/openai-is-shutting-down-atlas-but-its-ai-browser-ambitions-are-still-growing/
- OpenAI Help Center, Atlas retirement: https://help.openai.com/en/articles/20001371-chatgpt-atlas-retirement

**Market sizing (treat with suspicion)**
- AI browser market, ~$1.42B → $3.08B @ 9% CAGR: https://www.intelmarketresearch.com/ai-browser-market-46945
- AI browser market, $76.8B by 2034 @ 32.8% CAGR: https://market.us/report/ai-browser-market/
- Agentic AI market forecasts (~$7–11B 2026, 40–47% CAGR): https://www.grandviewresearch.com/industry-analysis/enterprise-agentic-ai-market-report
