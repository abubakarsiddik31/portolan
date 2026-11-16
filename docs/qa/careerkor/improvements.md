# Live-fire findings → Portolan improvements

| | |
|---|---|
| **Date** | 2026-11-16 |
| **Evidence** | First live-site QA run: [test-cases.md](./test-cases.md), [results.md](./results.md), drivers in `bench/local/careerkor/` |
| **Status** | Proposal backlog. Phase 2–7 are paused until G0 (ADR-009); nothing here starts work — it records what the live run proved, mapped to existing task IDs where they exist. |

## What the run proved first (keep, don't regress)

- Observation cost held on a real Next.js + Cloudflare site: **114–464 tokens/page** across 13 routes.
- Typed acts with effects (network/navigation/value) diagnosed a **silent login failure** — GA calls fired, no auth POST — without screenshots or console access.
- `read(ref)` readback exposed a value-loss bug instantly (accessible-name fallback vs actual value).
- The full loop — login, 11 authenticated pages, sign out, route guard — ran headless with zero special access.

## Improvements, ordered by what the run paid for

### 1. Quiescence as a substrate verb (feeds T2.13) — highest value

**Observed.** Every SPA navigation needed hand-rolled polling in the driver: `waitFor(pattern)` and a text-stability loop (`gotoPage`). Before these, snapshots caught `title: "Loading"` and stale DOM; flaky clicks (`not_interactive`) and lost fills traced back to the same root cause. After adding settle logic, the recorded run went 27/29 clean in one pass.

**Change.** Add a `settle` step inside `Substrate.goto` and `Substrate.act` (before re-capture):
1. Title is not a loading marker and document epoch is stable.
2. Network-quiet window (CDP events are already recorded; e.g. no in-flight request for 500 ms).
3. Snapshot stable across two consecutive captures (node count + text length).

Budget default ~10 s, configurable; `settle: false` escape hatch for tests that want raw speed. This single change deletes ~80 lines of driver code and the largest flake source.

### 2. Typed errors from the engine (feeds T2.07/T2.13 hardening)

**Observed.** `PlaywrightEngine.fill` threw a raw CDP error (`DOM.focus: Element is not focusable`) instead of returning a typed failure; only `setFiles` handles engine errors today. `not_interactive` also returned bare once — no blocker ref, role, tag, or text — on a hydration race.

**Change.**
- Wrap `fill`/`click`/`select` dispatches in the same typed-error contract as `setFiles`; map CDP focus/interaction failures to `EngineError` codes (`not_focusable`, `not_found`, `disabled`), and surface them as `invalid_request`/`not_interactive` ActResults.
- `not_interactive` must always carry diagnostics: the hit-test occluder when present, else the target's bounds + visibility facts (a zero-size or animating element is a different story than an overlay).

### 3. Readback-verified fill (the "sticky fill" pattern)

**Observed.** The email fill was lost to a mid-fill route change (locale `_next/data` fetch re-rendered the form); readback showed the accessible-name fallback, not the typed value. Click-to-focus + retry fixed it; the recorded login then passed first-try.

**Change.** Offer value verification inside `Substrate.act` for `fill`: after dispatch, `readValue` the target; on mismatch, click-to-focus and retry once. Opt-in flag (`verify: true`), default on for the QA runner helper. Without it, every harness re-implements the loop — and silent value loss is the worst failure mode a QA tool can have (it reported a *successful* fill that wasn't).

### 4. Stale-ref auto-recovery option (feeds T2.12)

**Observed.** Refs are document-scoped (correct design), but each driver carried an act → stale → re-find → retry loop. `new_ref` recovery exists when the hash matches; it doesn't cover re-renders that change name/ordinal.

**Change.** `Substrate.act` option `recovery: "re-snapshot"`: on stale with no `new_ref`, take one fresh snapshot and attempt resolution by (role, name) before failing. Keep the raw path available; the option is for agent/runner callers.

### 5. Form-context ranking preference (feeds T2.11)

**Observed.** On `/sign-in`, the header "Sign In" button outranked the form's "Login" submit; clicking it re-navigated instead of submitting. The `ctx` field disambiguated, but only manual scripting used it.

**Change.** In `rankAffordances`, boost submit-verb buttons (`login`, `sign in`, `submit`, `save`, `continue`, `create`) when they sit inside a `form` landmark, and demote same-named buttons in `navigation`/`main` heroes. Conservative rule, verified against the fixture suite so the store/wizard/portal rankings don't shift.

### 6. Package the QA runner (candidate-D product seed — pending ADR-006)

**Observed.** `bench/local/careerkor/run-tests.ts` is already the product shape: test-case list → one-by-one execution → pass/fail with evidence markdown. It took one session to build on top of the substrate.

**Change.** If candidate D wins T6.03, extract a shared runner: test cases as data (id, feature, steps, expected), execution engine (settle, retry, readback, evidence), results renderer. CareerKor becomes the first customer instance; the same runner is the compiler's verifier (T3.12) with a different front door. Authoring guide = T1.12's done-criteria language.

**Status 2026-11-16.** The bench-level harness is landed (`bench/qa/harness.ts`): settle-aware navigation, retry acts, readback fills, case runner, markdown renderer — unit-tested on a mocked engine. Product packaging in `packages/` stays gated on ADR-006; migrating the careerkor runner onto the harness needs a live verification run.

## CareerKor-side fixes (their backlog, not Portolan's)

1. Empty `<title>` on `/dashboard`, `/profile`, `/reports` (confirmed; TC-NAV-03).
2. Login success path intermittently reloads to `/sign-in` with "Invalid email" despite valid credentials (1 of ~5 runs) — race or rate-limit messaging.
3. "Invalid email" shown for an empty field — distinguish required vs invalid.
4. Sign-in form does not submit on Enter in the password field.
5. Watch item: header "Sign In" click occasionally lost during hydration (2 of 5 exploration runs; 1 of 1 recorded run).

## Scheduling note

Items 1–5 are substrate/runtime work inside the paused Phase 2 scope — they refine T2.07, T2.11, T2.12, T2.13 and cost little new estimate (T2.13's quiescence was already planned; items 2–4 are its hardening detail; item 5 is a ranking tweak inside T2.11's budget). Item 6 is gated on the vertical decision (T6.03): if candidate D wins, it becomes a new Phase 0.5 task between T6.03 and T1.12, reusing the careerkor pack as the first oracle.
