# Decision Records

Short, durable records of decisions that were argued through. Each one states the decision, the reasoning, the consequences, the alternatives rejected, and the conditions under which we would revisit it.

Format loosely follows an ADR (Architecture Decision Record). Add a new record rather than editing an accepted one; supersede explicitly.

---

## ADR-001 — Stateful is the default session model

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik
**Related:** `PRD.md` §2, §6, §14.1; `docs/BUILD_PLAN.md` §3.3, §7, §12; `docs/ANALYSIS.md` §4.3

### Context

Portolan can expose a browser to an agent in two shapes:

- **Stateful:** the server holds the page, DOM, history, network, cookies, and a map of element refs. The agent holds a `sid` and short refs. Each call returns only what changed.
- **Stateless:** each call is self-contained. The server (or a fresh browser) is given everything it needs, observes the page, acts, and returns a full observation. The caller carries the history.

The two shapes are usually presented as an integration-convenience trade-off. They are not. They produce different cost curves, and the cost curve is the product.

### Decision

**Stateful is the default.** Every session is created explicitly (`POST /v1/sessions` → `sid`), every verb is addressed by `sid`, and every response carries a document version `v`. A stateless surface exists as `session: "ephemeral"` on create — a thin compatibility adapter over the same stateful core, not a second architecture.

State is **explicit, not hidden**: `sid` is in every path, `doc` and `v` are in every response, refs are scoped to `(sid, doc)` (Amendment 1), and `stale_ref` is a typed, recoverable error. The failure mode we are avoiding is implicit server-side state that the caller cannot see or invalidate.

### Rationale

**1. It is the mechanism, not an implementation detail.**
The entire cost argument is O(n²) → O(n): today the agent re-sends every prior observation each step, so a 30-step task bills ~450k input tokens; with state in the browser and affordances/deltas on the wire, the same task is ~9k tokens (`ANALYSIS.md` §4.3). A stateless default reintroduces the quadratic term by construction. It would make Portolan a slightly better-formatted snapshot library — competing with Playwright MCP and agent-browser on token formatting — not a cheaper interaction model. The 5x launch gate would be measuring a number the architecture had already forfeited.

**2. Refs require a document version the server owns.**
A ref is only meaningful relative to a specific document state. If the server does not hold that state, it must either re-resolve the ref on every call or hand the agent a ref map to carry — which is state in the conversation again, just relocated. Stateful lets `ref` stay a 4-character opaque handle and lets the server own invalidation: `stale_ref` + `current_v` + `new_ref`. That is the difference between a protocol and a serialization format.

**3. Deltas require a "before".**
An effect is a difference. Without a previous semantic projection held server-side, `act` has to return a full snapshot, and the ≤15% delta target (`PRD` R4) is impossible. The delta engine is not an optimization layered on top of a stateless API; it is a consequence of the stateful one.

**4. Hibernation is the idle-time cost lever.**
The economics only close if a session can be parked and resumed instead of rebuilt. A stateless call has no session to park, so every invocation pays cold start and re-observation. Stateful + `freeze`/`hibernate` turns idle time into disk, which is the only way the per-task bill stays low across long, human-in-the-loop workflows.

**5. The buyer's job is a session, not a function call.**
The PRD's jobs-to-be-done are multi-step, auth-gated, and sometimes paused: "when my agent fails halfway through a checkout, resume exactly where it left off instead of restarting." A function-call API cannot satisfy that without pushing session management into every caller, where it will be duplicated, inconsistent, and buggy. The buyer is a platform team that owns a pager; they want fewer things to own, not a state machine to reimplement.

**6. The server owning timing reduces retries.**
"Browser owns timing" (`PRD` §6, rule 5) — scroll-into-view, hit-test, quiescence wait, one retry — only works if the browser knows what happened before. Server-side state lets us keep the modal from step 3 open, remember the focused field, and retry against the same document version. That drives `actions per intent` toward ≤1.2, which is a cost lever independent of token count.

**7. The adoption risk is a surface problem, not an architecture problem.**
`browser-use` users expect a function call. The answer is `session: "ephemeral"`: create, run one verb, tear down, return a self-contained result. It is a thin adapter over the stateful core — the same pattern as stateless HTTP over stateful TCP. It covers the hello-world and batch-script cases without forking the product. MCP (P1) is a second surface over the same core.

### Consequences

**Positive**
- The cost mechanism (small per-step observations) survives; the 5x gate is measurable on the architecture we actually ship.
- Deltas, effects, stable refs, and hibernation are all coherent, not bolted on.
- One place to enforce policy (egress allowlist, credentials, untrusted page text), timing, and recovery.
- The audit log (`PRD` R17) has a natural home: the session.

**Negative**
- Sessions are addressable resources: lifecycle bugs, leaks, and stale-state bugs are now possible.
- Horizontal scaling needs sticky routing or session migration; live sessions consume memory.
- Debugging is harder: a failure depends on prior calls, not just the current request.
- The ref-stability contract becomes a public promise we must measure, not hand-wave.

**Mitigations**
- Explicit `sid`/`v`; no hidden state.
- `freeze` for short idles, `hibernate` for long ones; snapshot is the recovery point after a crash.
- Typed errors with recovery hints (`stale_ref`, `timeout`, `engine_crash`).
- Bounded session TTL and a per-host live-session cap.
- Replayable audit log from day one of P1.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Stateless default** | Every response becomes a full snapshot; makes deltas and short refs impossible; turns the product into a formatting layer. The integration win is real for the first call and negative by the tenth. |
| **Stateless-only** | Same, permanently. No refs, no deltas, no hibernation, no resume. This is Playwright MCP with a different name. |
| **Caller-managed state** (server is a pure function; caller passes the snapshot back) | Moves the state into the agent's context — exactly the cost we are trying to remove — and makes every caller reimplement ref invalidation. |
| **Hidden server state with no `sid`/`v`** | The worst of both: stateful cost with stateless ergonomics, plus no way for the caller to detect staleness. |

### Revisit triggers

Reconsider the default only if one of these becomes true:

1. **Ephemeral dominates.** If >80% of production calls use `ephemeral` and stateful sessions are rare, the market is saying the integration cost outweighs the cost win. Keep the stateful core; reconsider the default surface.
2. **A competitor publishes a stateless $/task within 2x.** That would falsify the mechanism claim, not just the implementation.
3. **Hibernation cannot get under ~1s wake.** Long-idle workflows would then pay too much for the stateful model; revisit the storage strategy (e.g., a cheap Tier 1 representation).
4. **Session operations become the dominant failure mode.** If stale-state and lifecycle bugs cost more success rate than the cost win buys, the guardrail (2 points) decides.

None of these are true today. The decision stands.

### Amendment 1 — 2026-11-08 (decision unchanged; rationale corrected)

An adversarial review (`BUILD_PLAN.md` §15) found that rationale #1 overstated the mechanism.

- **Rationale #1 is withdrawn as written.** The O(n²) → O(n) framing is wrong. The quadratic term lives in the agent's conversation history, which the caller's harness controls, not Portolan. A stateful browser does not stop a harness from keeping every prior tool result. The 450k → 9k arithmetic is per-step size × 30, so it is linear, and the 40x is entirely observation size.
- **Replacement for #1:** statefulness is what makes each observation small. Deltas (#3) need a server-held "before"; short stable refs (#2) need a server-held document. Without state, every response is a full snapshot, and Portolan does collapse into a formatting layer competing with `agent-browser` and Playwright MCP. That is still the reason to reject a stateless default. #2 and #3 are now the load-bearing arguments.
- **Rationale #4 and #5 are qualified.** `hibernate` re-navigates on wake and cannot restore JS heap state or POST-result pages. "Resume exactly where it left off" holds for `freeze` only (`BUILD_PLAN.md` §7.5).
- **Rationale #7:** `ephemeral` runs a `steps[]` batch, not one verb.
- **Revisit trigger #2 is replaced:** "Portolan beats `agent-browser` by under 1.5x on the same runner and history policy (`BUILD_PLAN.md` §9.3, arm B vs C)." A competitor's published number could reflect better engineering rather than a broken mechanism; our own controlled comparison cannot.

---

## ADR-002 — The product is a site-map runtime, not a browser for agents

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik
**Related:** ADR-001; `docs/BUILD_PLAN.md` (v2); `docs/SUBSTRATE.md`; `docs/archive/BUILD_PLAN_v1.md` §15; `PRD.md` one-liner

### Context

v1 planned a stateful browser that shows agents compact affordances and deltas. The adversarial review found its win is per-step observation size, which free tools (`agent-browser`, Playwright MCP) already capture; an estimate put Portolan at ~1.15x over them. Meanwhile the PRD's one-liner already said the real goal: "synthesizes a temporary API for any website." The owner's goal is an agent that sees a **map** of a site and **calls APIs**, not one that looks at screens.

### Decision

Portolan serves each site as a **map**: named states, typed operations (`params`, `returns`, preconditions, declared effects), and transitions. Agents call operations; the runtime executes each through the cheapest verified tier (`webmcp` → `url` → in-page `http` → semantic `ui` → `agent` fallback). Maps are compiled offline from traces of successful runs, verified by replay, and repaired when they break. The v1 browser layer stays as the **substrate** that runs UI ops, hosts the fallback, and records traces.

### Rationale

1. **Steps, not tokens per step.** One typed call replacing ~10 clicks is a lever free snapshot tools and falling token prices don't erase.
2. **The agent plans better over names and data than over element lists.** Typed returns remove whole classes of misreads.
3. **A verified map library can compound;** a formatting layer can't. This is the first credible answer to `ANALYSIS.md` §5.1 ("no moat today").
4. **Writes become governable.** Declared effects, confirmations, idempotency checks, and `unknown_outcome` let a platform team allow an agent to submit or buy at all.
5. **ADR-001 still holds.** A map needs a live session to recognize state, route to preconditions, and run UI ops.

### Consequences

- The pattern is crowded (WALT, SkillWeaver, Integuru, Parse, Notte, workflow-use, Stagehand caching). Our differentiation must be the state model, write safety, published verification/drift numbers, and one vertical's map library, not the compilation technique.
- New hard problems: segmentation and parameterization of traces, drift, write safety, ToS exposure of private endpoints.
- The benchmark changes to repeated task templates, with compile cost amortized and a drift run.
- The token-per-step work is demoted to the fallback path.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Keep v1 (affordance browser)** | Estimated ~1.15x over free tools; fails its own gate. |
| **Network-only APIs (Integuru/Parse style)** | Writes are unsafe without the site's client-side logic; no fallback when endpoints change. Kept as one tier. |
| **Workflow recorder (one task → one script)** | No shared state model; doesn't compose; every new task is a new recording. |
| **Wait for WebMCP** | Requires site cooperation; years from coverage. Consumed as the best tier when present. |
| **Hand-authored maps as the product** | Doesn't scale past a few sites. Kept for the Day 2 ceiling test and as a fallback strategy if compilation fails G1. |

### Revisit triggers

1. **G0 fails:** hand-written ops don't give ≥3x fewer steps and ≥5x lower cost than `agent-browser`. Stop.
2. **G1 fails:** compiled maps reach <60% of the oracle's win. Narrow to human-recorded maps.
3. **G2 fails:** drift repair <80% or any duplicate write. Reads-only, or stop.
4. **A competitor ships a state-model runtime with write safety and published drift numbers** before we reach G2. Then the vertical library is the only remaining bet.

---

## ADR-003 — Provider- and LLM-agnostic; MCP for execution, Agent Skills for knowledge

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik
**Related:** ADR-002; `docs/BUILD_PLAN.md` §5.4, §6.1, §7, §7A, §10

### Context

Buyers have already chosen their models and agent clients, and they change them. A site-map runtime that only works with one provider is a feature of that provider. The owner wants Portolan usable from any model, through MCP and Skills.

### Decision

1. **No LLM in the hot path.** Verified op calls are deterministic.
2. **The fallback is the caller's own agent.** When no op fits, the calling agent finishes the step with Portolan's `view`/`act`/`read` tools inside a recorded fallback scope. Portolan runs no second agent for live calls.
3. **One `ModelPort` for everything else** (offline compile, headless repair), with provider adapters via the Vercel AI SDK: Anthropic, OpenAI, Google, and any OpenAI-compatible endpoint, including local models. Only the `model` package imports an LLM SDK. Models are configured per role.
4. **MCP is the execution layer:** a portable surface (`list_sites`, `open_site`, `call`, fallback tools) that works on every client, plus native per-op tools where clients support `tools/list_changed`. Tool names and schemas follow a portable profile enforced by a lint.
5. **Agent Skills are the knowledge layer:** one hand-written `portolan` skill (operating protocol) and one generated `portolan-<site>` skill per map version (when to use, ops, recipes, gotchas). Skills never execute and are never required.

### Rationale

- **Agnostic by construction, not by adapter count.** The parts that need judgment at call time use the buyer's model through MCP; the parts Portolan runs itself are deterministic or offline behind one port.
- **Enforcement lives in MCP; guidance lives in Skills.** A weaker model may ignore a skill's advice, so confirmations, write scoping and `unknown_outcome` are enforced server-side.
- **Skills scale the site library cheaply.** Only a skill's description loads until it's needed, so hundreds of sites cost ~100 tokens each, not hundreds of tool schemas.
- **Both are open formats with broad client support** (MCP across all major clients; `SKILL.md` across 40+ clients including Claude, Codex, Copilot, Cursor, Gemini CLI).

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **One vendor SDK in core** | Lock-in; contradicts the goal. |
| **MCP sampling to borrow the client's model** | Deprecated in MCP spec 2026-07-28; client support was patchy; the compiler runs offline with no client present. |
| **Portolan-side fallback agent on every call** | Pays for a second model, picks a provider for the buyer, and hides the fallback from the caller. |
| **Skills as the execution layer (scripts in skills)** | Skills need shell access, aren't available in every client, and can't enforce safety. |
| **Native per-op tools only** | Breaks on clients that ignore `tools/list_changed` or cap tool counts. |
| **LangChain / LiteLLM** | Heavier than needed for two call shapes; LiteLLM would add a Python service. |

### Consequences

- Every gate must hold on at least two providers, and cross-model transfer (compile with X, call from Y) is measured.
- A client conformance suite (Claude Code, Codex CLI, one more) is part of the benchmark.
- Op schemas are limited to a portable JSON Schema subset; richer validation runs server-side.

### Revisit triggers

1. A gate passes on one provider and fails on another by more than 10 points: we are not agnostic yet.
2. A major client drops `SKILL.md` or MCP support.
3. A provider-neutral way to borrow the caller's model returns to the MCP spec.

---

## ADR-004 — Rename Facet to Portolan

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik

### Decision

The project, repository, CLI, packages, MCP server and skills are named **Portolan** (`portolan`, `portolan-server`, skill `portolan` and `portolan-<site>`).

### Rationale

- **It names what the agent does.** Portolan charts were sea charts drawn from the logbooks of sailors who had made the voyage, used to navigate by chart instead of by sight. Portolan's agents don't surf screens; they call routes from a map compiled from earlier agents' runs.
- **It gives the product a vocabulary:** a site's map is a chart, ops are routes, generated skills are sailing directions, repair is re-surveying.
- **Facet collided** with Facets Cloud (an AI-agents + MCP platform selling to platform teams), an existing FACET MCP server, a wealth-management brand, and crowded developer search results.

### Known conflicts to resolve before launch

| Conflict | Risk | Action |
|---|---|---|
| npm `portolan` 0.1.0 (Aug 2026, wighawag): "a format for describing UI flows so one context can resolve them and a fresh context can implement them" | Medium: adjacent idea, takes the bare npm name | Publish under a scope (`@portolan/*`) if available; otherwise `@<org>/portolan-*`. Watch it. |
| "Portolan: Local Dev Servers" (Mac App Store developer utility) | Low: different product, same audience | Note for trademark review. |
| GitHub user `portolan` exists | Low | Use a different org name for the public repo. |
| Trademark classes 9/42 | Unknown | Counsel search before any public launch. |

---

## ADR-005 — G1/G2 are not passed; release gate stays closed

**Status:** Accepted, 2026-11-09
**Deciders:** Abubakar Siddik
**Related:** `docs/G1-G2.md`; `docs/PROJECT_PLAN.md` §1 (R4), §4 (T4.14); ADR-002, ADR-003

### Context

The plan makes G0, G1, and G2 stop/go gates, and R4 requires all three to be
passed and recorded here before v0.1.0.

The harness now runs end to end on the frozen commit
`98d8af4cd800f7720da76ab7ea6acf3b933fab03`:

- the compiler produces maps from fallback traces and verifies every op on
  three fresh sessions;
- the held-out maps are frozen with a SHA and a model;
- arm C produced 48 scored rows on 16 held-out templates;
- the drift run repaired 3/3 ops with 0 duplicate writes and 3/3 drift-day
  success;
- Claude Code and Gemini CLI pass the MCP conformance prompt; Codex CLI is
  blocked by a 402 from its own account.

But every row is `provider: scripted`, `model: scripted`. No provider key was
configured. There are no oracle rows, no second provider, no real-model
failure, and the drift sample is three ops and one run. The filter and
paginate drifts are semantic (the op succeeds but returns the wrong rows) and
are not caught by the drift script.

### Decision

1. **G0, G1, and G2 are not passed.** Do not claim them in the README, a
   release note, a launch asset, or a benchmark table.
2. **R4 stays open.** v0.1.0 is not released on this evidence.
3. **The current artifacts are harness validations**, not gate results. They
   may be published only with that label.
4. **Run the missing measurement** before revisiting this ADR: arms A, B, C,
   and D-oracle on the 16 held-out templates, two providers, a model-Y
   transfer run, N=3 with billed usage, oracle rows, and a drift run with real
   models including the semantic filter and paginate failures and an
   idempotency-key retry.
5. **The plan's branch points apply only after that run:** G1 below 60% of the
   oracle's win → narrow to human-recorded maps; G2 below 80% repair or any
   duplicate write → reads-only release or stop.

### Rationale

- **The gates are economic, not feature checks.** "The compiler works" and
  "the compiler wins" are different claims. The scripted rows can prove the
  first; they cannot prove the second.
- **A false pass is worse than a delay.** Declaring G1 on $0 scripted rows
  would put a number in a launch post that no customer could reproduce.
- **The drift result is encouraging but small.** 3/3 is not 80% of a
  representative sample; it is a smoke test of the repair loop.
- **The client result is real.** Two clients passing the same MCP prompt is
  evidence for R2, not for G1 or G2.
- **The safety evidence is strong where it exists.** The forced mid-write
  failure (T2.24) and the review gate for irreversible ops are real; the
  drift run's zero duplicates is structural and does not replace them.

### Consequences

**Positive**
- The project does not ship a gate claim it cannot defend.
- The harness, maps, and repair loop are ready for the real run.
- The analysis names exactly which numbers are missing and how to get them.

**Negative**
- The release is blocked on provider access and a real-model run.
- The open-source runtime is usable experimentally, but the benchmark story
  is incomplete.
- The delay has a cost; the plan's schedule assumes the gates close on time.

**Mitigations**
- Keep the provider-backed run small: 16 templates, N=3, two providers, one
  transfer run.
- Publish the harness results with the `scripted` label so the work is
  visible without being mistaken for a gate.
- Use the plan's branch points rather than an open-ended delay.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Declare G1/G2 passed on the scripted rows** | The rows have no oracle denominator, no provider, and no model failure. It would be a fabricated gate. |
| **Declare G1/G2 failed and stop** | The gates were not measured; a failure cannot be inferred from missing data. |
| **Narrow to human-recorded maps now** | That is the branch for a measured G1 miss, not for an unmeasured gate. |
| **Reads-only release now** | That is the branch for a measured G2 miss or a duplicate write; neither was observed at scale. |
| **Ship without the gates** | R4 is a release criterion, not a suggestion. |

### Revisit triggers

Revisit and supersede this ADR when:

1. the provider-backed N=3 run produces arm and oracle rows on two providers;
2. the drift run covers the semantic failures and a retried write;
3. the canary has a 7-day pass rate for R5;
4. a measured G1 or G2 failure triggers one of the plan's branch points.

Until then, this decision stands.

---

## ADR-007 — One session, two projections: agent-native execution with a human-visible cockpit

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik
**Related:** ADR-001, ADR-002; `docs/VISION.md`; `docs/SUBSTRATE.md`; `docs/BUILD_PLAN.md` §9; `docs/PROJECT_PLAN.md` §9

### Context

Two shapes dominate the market, and both are wrong for a platform team.

- **A human UI forced onto an agent.** The model receives a DOM dump or a screenshot and infers what a person would click. State lives in the conversation, the bill grows with the step count, and the interaction is a translation of a human interface.
- **A black-box agent.** The model gets a clean API, but a human cannot see what it is doing, cannot stop it, and cannot explain a failed write.

The current plan listed "a human-facing browser UI" as a non-goal. That protected the build from scope creep, but it also removed the trust surface a buyer needs before allowing writes. The direction has changed: the human view is not the product, but it is a first-class projection of the product.

### Decision

1. **One session, one append-only event log.** Every observation, action, effect, state transition and write is an event. The log is the source of truth and the audit trail.
2. **Two projections.** The agent projection is the map, typed ops, affordances, deltas and effects. The human projection is a live viewport, action timeline, inspector and audit log. Neither is derived from the other; both are derived from the event log.
3. **Explicit control ownership.** `control_owner: "agent" | "human"`. A human takeover pauses the agent, grants input control, and on release forces a re-observation, bumps the document version, and invalidates refs.
4. **The runtime is headless-first.** The cockpit is an optional package that attaches to a session. Nothing in the runtime depends on it.
5. **The cockpit ships after v0.1.0.** The event log and control protocol are foundational and land in P2; the cockpit is a v0.2 workstream and must not delay G0/G1.

### Rationale

- **Trust is a feature.** A platform team will not let an agent near a payment form it cannot watch. The cockpit is the difference between a demo and a procurement approval.
- **Debugging is a feature.** A failed op is a sequence of events, not a stack trace. Replay is the support tool.
- **Takeover needs one state.** A separate viewer browser would diverge from the agent's page within one action. One session is the only way to make "stop and take over" safe.
- **Open source needs a demo surface.** People adopt what they can watch. The cockpit is the best explanation of the interaction model.
- **It preserves the thesis.** The agent still uses maps, not screens. The human view is a projection, not the interface the agent uses.

### Consequences

**Positive**
- A single event model gives replay, audit, canaries and the cockpit for free.
- Human oversight becomes a protocol feature, not a UI hack.
- The open-source cockpit is an adoption channel and a community contribution surface.

**Negative**
- New event schema, streaming transport, redaction rules and a control protocol.
- The cockpit is real product surface: auth, redaction, latency, accessibility.
- Takeover introduces concurrency and conflict resolution between agent and human.

**Mitigations**
- Event schema is versioned and additive; the log is JSONL/SQLite, not a message bus.
- Screenshots on action/state change by default; screencast only in watch mode.
- The cockpit is local-only by default, bound to localhost with a session token, and redacts secrets.
- The control lock is explicit; the agent cannot act while `control_owner` is `human`.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **No human view** | Black box; blocks writes and enterprise adoption. |
| **A separate viewer browser** | Diverges from the agent's session; takeover is unsafe; two sources of truth. |
| **Screenshot-only viewer** | Good for watching, useless for inspecting state, effects or a failed write. |
| **VNC / noVNC** | Heavy, exposes a full desktop, and still does not show typed ops or effects. |
| **Cockpit in v0.1.0** | Would delay the gates and turn a runtime into a browser product. |

### Revisit triggers

1. **The cockpit delays a gate.** Cut it from the critical path; keep the event log.
2. **Takeover conflicts cost success rate.** Restrict takeover to paused sessions first.
3. **Streaming cost dominates.** Drop to action-triggered screenshots only.
4. **A client provides its own cockpit.** Keep the event log; expose it over a stable API.

---

## ADR-008 — Open source: Apache-2.0 runtime, MIT cockpit, CC-BY map spec

**Status:** Accepted, 2026-11-08
**Deciders:** Abubakar Siddik
**Related:** ADR-004, ADR-007; `docs/VISION.md`; `LICENSE`; `SECURITY.md`

### Context

Portolan's distribution depends on agents and clients adopting a protocol and a map format. A proprietary runtime would make every integration a vendor negotiation. The durable asset is not the source code; it is the verified map library, the safety model, and the published benchmark.

### Decision

- **Runtime, SDK, CLI, skills:** Apache-2.0.
- **Human cockpit:** MIT.
- **Protocol and map spec:** CC-BY-4.0.
- **Open formats:** MCP for execution, Agent Skills for knowledge, JSON maps in git.
- **No AGPL dependency in the default path.** Lightpanda remains an optional adapter until counsel clears it.
- **Verified maps are signed** and carry replay history before they receive the badge.
- **Business model:** hosted runtime, concurrency, observability, vertical map packs, support. Never per-browser-hour; never the source code.

### Rationale

- **Adoption is the moat.** A protocol only matters when other people implement it. Apache-2.0 removes the legal friction.
- **Maps are the compounding asset.** Code can be copied; a verified, canaried map library for one vertical cannot be copied without the runs.
- **Open source improves safety.** A write path that many people can inspect is more trustworthy than one that is hidden.
- **The buyer already chose a model and a client.** An open runtime fits; a proprietary one asks them to switch.

### Consequences

- Community maps need review, signing and a canary history; an unsigned map is not verified.
- The cockpit becomes a community surface with its own maintainers and accessibility bar.
- The project needs governance: a contributing guide, a security policy, a code of conduct and a release process.
- The business must sell operations and trust, not access to code.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **AGPL runtime** | Blocks enterprise adoption and the hosted model; the network clause is a legal tax on every customer. |
| **Open-core with a closed runtime** | The protocol is the distribution; a closed core makes every integration a negotiation. |
| **Proprietary map registry** | The registry is the asset, but locking it prevents the community from growing it. |
| **MIT everywhere** | No patent grant for the runtime; Apache-2.0 is the better default for infrastructure. |

### Revisit triggers

1. **A major contributor requires a different license.** Revisit with counsel, not in a PR.
2. **Community maps create a security incident.** Tighten signing and review before widening contribution.
3. **The hosted business cannot fund the commons.** Add a foundation or a sponsorship model, not a license change.

---

## Related decisions (one-line rationale)

| Decision | Why |
|---|---|
| **Playwright over raw CDP** | Buy the boring parts (navigation, waiting, input, storageState, downloads, tracing) and spend the innovation budget on the semantic/delta layer. Raw CDP is a six-month detour to rebuild a browser driver. |
| **CDP inside Playwright for the semantic layer** | Playwright's public API does not expose `backendNodeId`, layout bounds, or paint order; CDP does. Use each for what it is best at. |
| **Diff the semantic projection, not HTML** | HTML diffs are noisy and token-expensive; the semantic projection is already normalized and small, which is what makes ≤15% deltas achievable. |
| **TypeScript core, Python baseline** | The protocol is JSON, the MCP SDK is TS, and Playwright's reference API is TS. The one Python dependency (browser-use) is the baseline, and it stays isolated behind a process boundary. |
| **Fixtures + real tasks** | A benchmark you cannot rerun is marketing. Twelve versioned fixtures make the meter trustworthy; eight pinned real tasks keep it honest. |
| **`freeze` / `hibernate` split** | Chromium cannot both free the renderer and wake in 15ms. Pick the right mode per idle length instead of promising a physically impossible pair. |
| **Meter counts the wire body, pre-meter** | The agent pays for what it receives, not for our internal model. Counting before attaching the meter avoids a self-reference and makes the number reproducible by hand. |
