# Facet — Research & Analysis

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

> The browser should hold the state; the agent should hold only a handle. Then agents receive affordances, effects, and deltas instead of documents — and cost per completed task falls ~40x.

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
- Consumer "agentic browsers" (Atlas, Comet, Dia) are browsers *for humans with an agent attached* — the opposite architecture from what Facet proposes, and the one that just failed.
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

### 4.3 The accumulation problem (the real mechanism)

The naive loop re-sends the whole conversation each step: system prompt + all prior observations + all prior actions. Cost is therefore superlinear in step count.

Approximate arithmetic for a 30-step task **[H]**:

| Approach | Tokens / step | Total input tokens | Cost @ $3/M |
|---|---|---|---|
| Raw HTML + screenshot history | ~15,000 | ~450,000 | ~$1.35 |
| Accessibility tree, re-sent each step | ~6,000 | ~180,000 | ~$0.54 |
| **Affordances + deltas, state in browser** | **~300** | **~9,000** | **~$0.03** |

Roughly **40x**. The mechanism is not "smaller pages" — it is that **steps stop carrying history**, because history lives in the session.

### 4.4 The three levers

```
cost = steps × tokens_per_step × token_price  +  browser_minutes × $/min
```

- **Compute work** attacks the last term: ~7% of spend.
- **Interaction model** attacks the first two: ~93% of spend.

Facet attacks the first two. Compute efficiency is a hygiene requirement, not the product.

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
| **Facet** | Affordances + effects + deltas + hibernation + engine-agnostic | New session model to adopt; JS fidelity bounded by engine |

### 5.1 Moat assessment — honest

There is **no moat today**: no network effects, no switching costs (CDP is open), no scale economies (it is a price war), no counter-positioning. The only plausible sources are:

- **Cornered resource** — an engine nobody can replicate. Expensive, and Lightpanda already occupies it for free.
- **Process power** — a semantic/affordance model measurably better than everyone's. This is an evals-and-product problem, which is where the defensibility actually is.

Thin for an infrastructure company. Reasonable for a product company with a published benchmark.

### 5.2 The standards threat

WebMCP is a **W3C draft authored by Google and Microsoft**, with a Chrome implementation behind a flag. If sites declare their own tools, runtime synthesis becomes less necessary. Do not fight this — **support it as a fast path** (PRD R20). A startup cannot win a standards war; it can ride one.

---

## 6. Reasoning trail

The thesis changed three times. Recording this matters, because the discarded versions are the ones a new team will drift back toward.

### v1 — "A browser engine built for agents, cheaper to run"
**Killed by:** commodity pricing ($0.02/hr), token-dominated cost (93%), and Lightpanda occupying the exact position for free with $4.5M raised.

### v2 — "A routing ladder: fetch → DOM-only → full browser"
**Partially true, insufficient as a product.** The insight is correct (most agent traffic is read-only and needs no browser), but Tier 0 is already a crowded, well-funded category (Firecrawl $75M, Exa, Jina). The ladder is a *feature* of the chosen product, not the product.

### v3 — "A stateful browser that synthesizes a temporary API for any site"
**Survived.** It sits in the unoccupied space between Chrome-in-a-trench-coat (gives a document) and WebMCP (requires site cooperation). It attacks the 93% rather than the 7%. And it produces a number nobody else publishes: **$ per completed task**.

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

### What must be true for Facet to be a company

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
4. **Open-source `facetd` or not?** Lean: open protocol, hosted runtime.
5. **First vertical.** Support ops vs procurement vs insurance eligibility.
6. **Trademark clearance** for "Facet" in classes 9/42.

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

**Standards**
- WebMCP: https://www.webmcp.md/
- WebMCP technical notes (W3C CG): https://w3c-cg.github.io/aikr/webMCP/webmcp-technical-notes.html

**Negative signals**
- Atlas shutdown (2026-08-09), TechCrunch: https://techcrunch.com/2026/07/09/openai-is-shutting-down-atlas-but-its-ai-browser-ambitions-are-still-growing/
- OpenAI Help Center, Atlas retirement: https://help.openai.com/en/articles/20001371-chatgpt-atlas-retirement

**Market sizing (treat with suspicion)**
- AI browser market, ~$1.42B → $3.08B @ 9% CAGR: https://www.intelmarketresearch.com/ai-browser-market-46945
- AI browser market, $76.8B by 2034 @ 32.8% CAGR: https://market.us/report/ai-browser-market/
- Agentic AI market forecasts (~$7–11B 2026, 40–47% CAGR): https://www.grandviewresearch.com/industry-analysis/enterprise-agentic-ai-market-report
