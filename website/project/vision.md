# Portolan — Vision

| | |
|---|---|
| **Status** | Accepted direction, 2026-11-08 |
| **Scope** | Why Portolan exists, the interaction model, the open-source model, and the capability ladder. |
| **Related** | `DECISIONS.md` ADR-001–004, ADR-007, ADR-008; `BUILD_PLAN.md`; `PROJECT_PLAN.md` |

---

## One sentence

**Portolan is an open-source, agent-native web runtime: agents call verified maps of a site, and humans watch, audit, and take over the same session in real time.**

It is not a browser for humans with an agent bolted on, and it is not a screen-scraper that forces a human interface onto a model.

---

## The two failure modes

Every product in this space fails in one of two ways.

**1. The human UI is forced onto the agent.**
The agent gets a DOM dump or a screenshot and is asked to infer what a person would click. The state lives in the conversation, every step re-sends the page, and the bill grows with the square of the step count. This is the current `browser-use` shape, and it is why a task costs dollars instead of cents.

**2. The agent is a black box.**
The agent gets a clean API, but a human cannot see what it is doing, cannot stop it, and cannot explain a failed write to finance. This is the current "autonomous agent" shape, and it is why platform teams will not let it near a payment form.

Portolan refuses both. The agent gets a map and typed operations. The human gets a live view of the same session. Neither is a translation of the other.

---

## The resolution: one session, two projections

```
Chromium / Lightpanda (CDP)
        │
        ▼
  session event log  (append-only, the source of truth)
        │
        ├──▶ agent projection   map · ops · affordances · deltas · effects
        └──▶ human projection   live view · timeline · inspector · takeover
        │
        ▼
  control bus   owner = agent | human
```

The event log is the source of truth. Both surfaces are derived from it. That gives us:

- **No divergence.** The human sees the same state the agent acts on.
- **Replay for free.** Every action, every observation, every effect is an event.
- **Safe takeover.** Pause the agent, take control, release; the runtime re-observes, bumps the document version, and invalidates refs.
- **Trust.** A platform team can watch the first ten runs before it allows writes.

The human surface is optional. The runtime is headless-first; the cockpit attaches to a session.

---

## The capability ladder

Portolan grows in layers. Each layer uses the one below it, and none of them requires a new architecture.

| Layer | What it gives | Built from | Status |
|---|---|---|---|
| **Read / search** | URL → markdown, site search, web discovery | Tier 0 fetch, Readability, an external search API | v0.2 |
| **Browse** | Unknown site: affordances, refs, `act`, `read` | The substrate (`/project/architecture`) | v0.1 fallback |
| **Operate** | Typed ops, writes, confirmations, drift repair | Maps, tiers, verifier, compiler | v0.1 core |
| **Research** | Multi-source synthesis with citations | The caller's model over read/search | v0.2 skill |
| **Cockpit** | Live view, timeline, inspector, takeover, audit | The event log | v0.2 |

**Operate is the wedge.** Search and research are crowded and usage-priced; browse is a commodity. The map library, write safety, and published drift numbers are the only things that compound. The other layers exist to feed and supervise operate, not to replace it.

**Research stays caller-side.** Portolan provides retrieval and operation primitives; the buyer's model does the synthesis. A server-side research agent would make Portolan a model vendor, contradict provider-agnosticism, and compete with Perplexity on its home turf. If caller-side composition demonstrably fails, that is a new ADR, not a feature flag.

---

## Principles

1. **Maps over screens.** An agent asks for an operation, not an element list.
2. **State lives in the session.** The agent holds a handle; the browser holds the page, history, and network.
3. **The hot path is deterministic.** No LLM inside a verified op call. Judgment belongs to the caller.
4. **Writes are governed.** Declared effects, confirmation, idempotency, `outcome_check`, and `unknown_outcome` as a first-class result.
5. **Provider- and client-agnostic.** MCP for execution, Agent Skills for knowledge, one `ModelPort` for the offline compiler.
6. **Open formats.** The protocol, map schema, and skills format are public and implementable by anyone.
7. **Human oversight is a projection, not an afterthought.** The same session feeds the agent and the cockpit.
8. **Rent the engine.** No rendering engine. Chromium now, Lightpanda later, behind a four-method adapter.
9. **Measure, don't assert.** Cost per completed task, success rate, drift survival, repair time. Published with raw data.
10. **Boring where it counts.** SQLite, JSON files in git, Fastify, Playwright. Save the novelty for the map model.

---

## Open source

Portolan is open source because the protocol is the product's distribution and the map library is its moat — not the code.

| Artifact | License | Why |
|---|---|---|
| Runtime, SDK, CLI | Apache-2.0 | Permissive adoption; patent grant; enterprise-friendly |
| Human cockpit | MIT | Maximum reuse; a community UI is an adoption channel |
| Protocol and map spec | CC-BY-4.0 | Anyone may implement; attribution keeps provenance |
| Skills | Apache-2.0 | Same as the runtime |

**Rules that keep it safe:**

- Maps are **declarative**. No arbitrary code execution from a map, a trace, or a generated skill.
- **Credentials never** live in maps, traces, skills, logs, or model prompts.
- **Verified** means replayed against ≥3 parameter sets, not "it ran once."
- Community maps are **signed** and carry a canary history before they get the verified badge.
- No AGPL dependency in the default path. Lightpanda stays behind an optional adapter until counsel clears it.

**Business model:** hosted runtime, concurrency, observability, vertical map packs, support. Not per-browser-hour, and not the source code.

---

## What v0.1.0 is

An open runtime that serves verified maps for ten sites in one vertical, over MCP, with a published benchmark and three design partners. It can read, browse as a fallback, and operate safely. It does not have a cockpit, hosted infrastructure, or a server-side research agent.

The gates decide whether it ships:

- **G0:** hand-written ops beat the best free alternative by ≥3x fewer steps and ≥5x lower cost.
- **G1:** compiled maps reach ≥60% of the oracle's win, with ≥50% compile yield and break-even K ≤3.
- **G2:** ≥80% of broken ops auto-repair within two runs, with zero duplicate writes.

If a gate fails, the plan says stop or narrow. That is a feature, not a failure.

---

## Non-goals

- A rendering engine, or a Chromium fork.
- A general-purpose browser for humans.
- A search index or a bulk crawl platform.
- A server-side research agent in v0.1.
- CAPTCHA solving or anti-bot evasion.
- Per-browser-hour pricing.
- A hosted multi-tenant service before the gates pass.

---

## How to help

The most useful contributions are maps, fixtures, and failure reports — not features.

1. Read `PROJECT_PLAN.md` and pick a task with `agent-ok`.
2. Read `CONTRIBUTING.md`; one task, one branch, one PR.
3. Add a fixture or a map for a site you know, with a success predicate.
4. Report a drift: a map that used to work and now does not. That is the data the repair loop needs.

The project is at its best when the map library grows faster than the codebase.
