# Portolan

> **Chart the web once. Every agent sails it.**

*Formerly Facet. Why the name: [ADR-004](./docs/DECISIONS.md).*

Portolan turns a website into a **map an agent can call**: the site's states, and typed operations like `search(query)`, `add_to_cart(product_id, size)` or `export(filter)` that move between them. Agents call operations instead of looking at screens and clicking. Maps are learned from real runs, verified by replay, and repaired when the site changes. Portolan works with **any model and any MCP client**: MCP carries execution and safety, Agent Skills carry the know-how.

Portolan is **open source** (Apache-2.0) and **agent-native with a human cockpit**: agents use maps, humans watch the same session and can take over. Read [the vision](./docs/VISION.md) and [ADR-007](./docs/DECISIONS.md).

---

## Status

**Early build. Open source (Apache-2.0). The gates have not been run yet.**

| | |
|---|---|
| Stage | Phase 5 complete: compiler, verifier, repair, MCP server, CLI, packaging, docs. Phase 6 (vertical and partners) is next. |
| Date of analysis | 2026-11-09 |
| Current plan | [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) (what and how) · [docs/PROJECT_PLAN.md](./docs/PROJECT_PLAN.md) (when and who) |
| First release | v0.1.0 public alpha, target **Tue 2027-03-02** |
| Gates | G0, G1, and G2 are **not passed**; the harness is scripted-only. See [ADR-005](./docs/DECISIONS.md) and [docs/G1-G2.md](./docs/G1-G2.md) |
| Key decisions | ADR-001 (stateful sessions), ADR-002 (site-map runtime), ADR-003 (provider-agnostic), ADR-004 (name), ADR-007 (one session, two projections), ADR-008 (open source) in [docs/DECISIONS.md](./docs/DECISIONS.md) |
| License | Apache-2.0 (runtime, SDK, CLI, skills) · MIT (cockpit) · CC-BY-4.0 (map spec). See [docs/LICENSING.md](./docs/LICENSING.md) |

---

## The thesis in one paragraph

Agents today are handed screens, DOM dumps, or element lists and asked to work out, click by click, what a website can do. Every click is a model step, and steps are what cost money, time and reliability. Compact page views help each step but don't remove any, and free tools already provide them. Portolan removes the steps: it gives the agent a map of the site, with named states and typed operations, and executes each operation through the cheapest path that has been verified (a URL, the site's own API request, or a semantic UI program), falling back to a step-by-step agent only when no operation fits. A ten-click checkout becomes three calls with typed results. Writes are governed: effects are declared, irreversible operations need confirmation, and a write with an unknown outcome is never silently retried.

**Portolan is not a browser for agents.** It is an API layer for websites that happens to run on one.

---

## What an agent sees

```
open_site("acme-store")
→ acme-store · map v14 · verified 2h ago · you are in: home (logged_in)
  search(query, page=1)                 → [{id, name, price, url}]       read
  add_to_cart(product_id, size, qty=1)  → {cart_count, subtotal}         write
  view_cart()                           → {items[], subtotal}            read
  checkout(shipping_id, payment_id)     → {order_id}                     irreversible · needs confirm
  fallback: view() / act() / read()
```

---

## Repository map

| File | What's in it |
|---|---|
| [docs/VISION.md](./docs/VISION.md) | **Start here for the why.** Agent-native maps, the human cockpit, the capability ladder, open-source model |
| [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) | Map model, op runtime, write safety, compiler, agent surface, stack, benchmark, gates, 15-day build order, landscape |
| [docs/PROJECT_PLAN.md](./docs/PROJECT_PLAN.md) | Schedule to v0.1.0 (Mar 2, 2027): release criteria, milestones, ~95 tasks with estimates and dependencies, gates, risks, commit and PR conventions |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | ADR-001 (stateful sessions), ADR-002 (site-map runtime), ADR-003 (provider-agnostic; MCP + Skills), ADR-004 (name), one-line rationale for other choices |
| [docs/SUBSTRATE.md](./docs/SUBSTRATE.md) | The stateful browser layer underneath: engine adapter, semantic engine, refs, effects, hibernation, meter |
| [docs/CONFIG.md](./docs/CONFIG.md) | Every config option with its type, default, and the command that reads it |
| [docs/PACKAGING.md](./docs/PACKAGING.md) | The npm packages, the publish metadata, and the Docker image with Chromium |
| [docs/INSTALL.md](./docs/INSTALL.md) | MCP install snippets for Claude Code, Claude Desktop, Codex CLI, Cursor, Gemini CLI, and VS Code |
| [docs/SECURITY.md](./docs/SECURITY.md) | Threat model, write-path review, and the open security findings |
| [docs/spec/map-v0.md](./docs/spec/map-v0.md) | The site-map format: every field, the write rules, and validating examples |
| [PRD.md](./PRD.md) | Product requirements v0.2, aligned with ADR-002–005 |
| [docs/QUICKSTART.md](./docs/QUICKSTART.md) | From a clone to a working MCP call; the site also covers concepts, MCP, skills, and write safety (`pnpm docs:build`) |
| [docs/ANALYSIS.md](./docs/ANALYSIS.md) | Market evidence, cost model, competitive landscape, reasoning trail (v1 → v4), falsification criteria |
| [PRD.md](./PRD.md) | v0.1 requirements. Partly superseded by ADR-002; its verbs and architecture now describe the substrate. Rewrite pending. |
| [docs/archive/BUILD_PLAN_v1.md](./docs/archive/BUILD_PLAN_v1.md) | The v1 plan (affordance browser) and its adversarial review, written under the old name Facet, kept for the record |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Setup, commit and branch rules, PR process, code standards |
| [SECURITY.md](./SECURITY.md) | How to report a vulnerability privately; the security invariants |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [LICENSE](./LICENSE) | Apache-2.0 |

---

## Decisions already made

These were argued through and should not be re-litigated without new evidence.

1. **Do not write a rendering engine.** Rent engines behind a four-method adapter. Playwright/Chromium first.
2. **The product is the map, not the browser** (ADR-002). Typed operations cut steps; compact observations only cut tokens per step.
3. **Sessions are stateful** (ADR-001). A map needs a live session to recognize state, route to preconditions, and run UI operations.
4. **No LLM in the hot path.** A verified operation runs deterministically. When no operation fits, the **caller's own agent** finishes the step with Portolan's fallback tools.
5. **Provider- and LLM-agnostic** (ADR-003). The offline compiler reaches models through one `ModelPort` (Anthropic, OpenAI, Google, any OpenAI-compatible endpoint including local models). Every gate must hold on at least two providers.
6. **MCP executes, Skills teach.** A portable MCP surface works on every client; one `portolan` skill plus a generated skill per site explain when and how to use each site. Safety is enforced by the server, never by a skill.
7. **Write safety beats completion.** Declared effects, confirmation for irreversible operations, idempotency checks, and `unknown_outcome` instead of blind retries.
8. **North star is `$ per completed task`**, with steps, success rate, and drift survival published alongside it.
9. **Never price per browser-hour.**

---

## Open questions

1. **First vertical.** Where map quality and write safety matter most: insurance eligibility, procurement portals, logistics carriers, or support ops?
2. **Who builds maps in the product:** compiled from agent runs (the plan's default), recorded by customers, or curated by us per vertical?
3. **Map registry governance.** How do community maps get verified, signed and distributed without turning the registry into a malware vector?
4. **ToS posture** for in-page calls to sites' private endpoints. Counsel before any hosted offering.
5. **Trademark and name clearance.** Renamed from Facet to Portolan (ADR-004). Run a proper class 9/42 search, and resolve the npm `portolan` package (an unrelated UI-flow format, Aug 2026) and the `Portolan: Local Dev Servers` Mac app before launch.

---

## Start here (new session prompt)

> Read `README.md`, `docs/VISION.md`, `docs/DECISIONS.md`, `docs/BUILD_PLAN.md`, and `docs/SUBSTRATE.md` in full before writing anything.
>
> We are building **Portolan**, a site-map runtime: agents call typed operations from a verified map of each site. Follow `docs/BUILD_PLAN.md` §11 in order. TypeScript on Node 24 LTS, pnpm monorepo, Fastify + Zod, Ajv for map schemas, Playwright/Chromium + CDP for the substrate, MCP TS SDK for the agent surface, Agent Skills (`SKILL.md`) for site knowledge, Vercel AI SDK behind `ModelPort` for any model, SQLite + map files in git.
>
> Day 1–2 come first and decide everything: run `browser-use` and `agent-browser` on 3 dev fixtures with billed usage **on two providers**, then hand-write ops for those fixtures and run them over MCP. **If hand-written ops don't give ≥3x fewer steps and ≥5x lower cost than `agent-browser` (Gate G0), stop and report.**
>
> Constraints: no vendor SDK outside `packages/model`; no LLM in a verified op call; MCP tools follow the portable schema profile; writes default to the UI tier and are never auto-retried after an unknown outcome; tune only on dev fixtures; dollars come from billed usage, not our meter.

---

## Definition of done for the first build session

- [ ] G0 recorded on two providers: arms A (`browser-use`), B (`agent-browser`), D-oracle (hand-written ops) on 3 dev fixtures
- [ ] Map JSON Schema v0; runtime runs the oracle maps with identical results
- [ ] Compiler produces verified maps from fallback traces on held-out sites, with no human edits (G1)
- [ ] Drift run on v2 fixtures: repair rate, zero duplicate writes, drift-day success (G2)
- [ ] `portolan` skill + generated site skills validate; MCP conformance passes in Claude Code, Codex CLI, and one more client
- [ ] Cross-model transfer measured: maps compiled with one model, used by agents on another
- [ ] One table: success, steps/task, $/task (vs A and B, compile cost amortized), op coverage, compile yield, tier mix, drift survival, repair time

If G0 fails, we stop on Day 2. That is the point of testing perfect maps before building the compiler.

---

## License

Apache-2.0 for the runtime, SDK, CLI and skills. MIT for the human cockpit. CC-BY-4.0 for the published map spec. See [LICENSE](./LICENSE), [LICENSE-MIT](./LICENSE-MIT), [LICENSE-CC-BY-4.0](./LICENSE-CC-BY-4.0), [docs/LICENSING.md](./docs/LICENSING.md), and [ADR-008](./docs/DECISIONS.md).

Contributions are accepted under the same licenses. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first; one task, one branch, one PR.
