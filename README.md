# Facet

> **The web, one facet at a time.**

A stateful browser that synthesizes a temporary API for any website and talks to agents in **affordances, effects, and deltas** — so a web task costs cents, not dollars.

---

## Status

**Pre-build. Documentation only. No code yet.**

This repository exists to carry a complete, researched product thesis into the build session. Everything needed to start is here: the PRD, the market analysis, the reasoning trail, and the decisions already made.

| | |
|---|---|
| Stage | Pre-build / validated on paper, unvalidated in code |
| Date of analysis | 2026-11-08 |
| Next milestone | 20-task benchmark + cost meter (see [PRD §10](./PRD.md#10-launch-gates)) |
| Blocking question | Stateful vs stateless default session model |

---

## The thesis in one paragraph

Agents today are handed documents — DOM dumps and screenshots — and asked to infer an API. That is why a 30-step task bills ~450k input tokens and grows quadratically: the state lives in the conversation, so every step re-sends every previous observation. Facet moves the state into the browser. The agent holds a session handle and stable element references; the browser holds the page, history, and network. Steps become stateless, O(n²) collapses to O(n), and the per-task bill drops roughly 40x. Cheap compute is a constraint we satisfy, not the pitch.

**Facet is not a cheaper Chromium.** It is an interaction model that happens to need a browser.

---

## The product surface: five verbs

```jsonc
goto   →  affordances        // ranked, typed, token-budgeted action list
act    →  effects + delta    // what changed structurally, never a full snapshot
read   →  markdown           // explicit, separate from acting
sleep  →  snapshot to disk   // idle time becomes free
wake   →  restore in ~15ms   // resume mid-task, no restart
```

The agent never sees HTML. It asks *what can I do here*, does it, and is told *what changed*.

---

## Repository map

| File | What's in it |
|---|---|
| [PRD.md](./PRD.md) | Product requirements: problem, goals, five verbs, architecture, P0–P2 requirements, metrics, launch gates, risks, phases |
| [docs/ANALYSIS.md](./docs/ANALYSIS.md) | The full research and reasoning: market evidence, funding, pricing, cost model math, competitive landscape, the reasoning trail, rejected paths, falsification criteria, sources |

---

## Decisions already made

These were argued through and should not be re-litigated without new evidence.

1. **Do not write a rendering engine.** Rent engines behind a four-method adapter (`navigate`, `snapshot`, `dispatch_input`, `evaluate`). Start on Playwright/Chromium; swap to Lightpanda when its JS coverage justifies it.
2. **North star is `$ per completed task`.** Not browser-hours, not tokens. It is the metric nobody else in the category publishes, and it is the metric the buyer already tracks.
3. **Never price per browser-hour.** Hosted browsers sell at $0.02–$0.10/hr. That is the commodity the product escapes.
4. **A stateful browser is the mechanism.** State lives in the session, not in the agent's context. This is the entire cost argument.
5. **Cost may not buy success rate.** Any optimization that loses more than 2 points of task success is rejected.
6. **Launch gate is 5x cost reduction, not 2x.** At 1.5x we have a feature incumbents ship in a quarter.

---

## Open questions

1. **Stateful vs stateless default.** Stateful wins the cost argument; stateless wins adoption (`browser-use` users expect a function call). Current lean: stateful default, `ephemeral` compatibility mode.
2. **Protocol carrier.** HTTP/JSON for performance vs MCP-first for reach. Possibly MCP as a thin wrapper (already P1/R15).
3. **Ref stability contract.** How much re-render churn can an element ref survive before re-observation is mandatory?
4. **Open-source `facetd`?** Lean: open protocol, hosted runtime.
5. **First vertical.** Support ops, procurement, or insurance eligibility — which proves outcomes fastest?
6. **Trademark.** "Facet" collides with a wealth-management brand. Verify class 9/42 before committing to the name.

---

## Start here (new session prompt)

Paste this into a fresh session pointed at this repository:

> Read `README.md`, `PRD.md`, and `docs/ANALYSIS.md` in full before writing anything.
>
> We are building **Facet**, starting at PRD §8 P0 (R1–R11) and PRD §13 Phase P0.
>
> Build in this order:
> 1. Protocol skeleton (`facetd`) — the eight verbs in PRD Appendix A, HTTP/JSON, typed errors.
> 2. The **cost meter** — every response returns `{tokens, ms, mb}`. This is non-negotiable and comes before any optimization.
> 3. The **20-task benchmark harness** (PRD §10) with a `browser-use` + Playwright baseline, so cost-per-completed-task is measured, not asserted.
> 4. Then the semantic layer: affordance extraction, stable refs, effect classification, token budgets.
>
> Constraints: engine access only through the four-method adapter. No rendering engine. No pricing by browser-hour. Every claim in the PRD marked [H] is a hypothesis — the benchmark decides.
>
> Open question to resolve with me first: whether the default session model is stateful or stateless (see README Open Questions #1).

---

## Definition of done for the first build session

- [ ] `facetd` serves the eight verbs and rejects malformed input with typed errors
- [ ] Every response carries a reproducible `{tokens, ms, mb}` meter
- [ ] 20 real tasks defined, each with a pass/fail predicate
- [ ] Baseline numbers captured for `browser-use` + Playwright
- [ ] Facet numbers captured on the same tasks
- [ ] A single table showing: $/task, tokens/step, steps/task, success rate, p50 latency

If that table shows less than 5x, we stop. That is the point of building the meter first.
