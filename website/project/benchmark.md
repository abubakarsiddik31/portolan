# Benchmark report

**Date:** 2026-11-09
**Frozen evidence commit:** `98d8af4cd800f7720da76ab7ea6acf3b933fab03`
**Status:** harness validation, **not** gate results. [ADR-005](https://github.com/abubakarsiddik31/portolan/blob/main/docs/DECISIONS.md#adr-005--g1g2-are-not-passed-release-gate-stays-closed)
keeps G0, G1, and G2 unpassed.

> **Next run:** G0 on one vertical, with a real model and billed usage.
> More scripted rows do not close a gate (ADR-005, ADR-009).

This is the public-facing report. The detailed evidence is in
[G1-G2.md](https://github.com/abubakarsiddik31/portolan/blob/main/docs/G1-G2.md); the raw rows are in [`bench/results/`](https://github.com/abubakarsiddik31/portolan/tree/main/bench/results).

## 1. The question

Does a verified map of a site beat a document-shaped browser on the metrics
that matter — steps and cost per completed task — and does it survive drift?

The answer needs four arms on the same tasks:

| Arm | What it measures |
|---|---|
| A | `agent-browser` (or `browser-use`) with a model |
| B | Portolan's `view` / `act` / `read` fallback with a model |
| C | Portolan's map: `open_site` then `call` |
| D | An oracle: a human-written map with the same tiers |

G0 compares A and a perfect D. G1 compares C against D's win. G2 breaks the
site and measures repair. Without D there is no denominator, and without a
real model A, B, and C are not comparable.

## 2. What was run

### 2.1 Compiler on the dev fixtures

| Site | Oracle ops | Compiled | Coverage | Yield | Held | Tier mix (compiled) | Tier mix (oracle) |
|---|---:|---:|---:|---:|---|---|---|
| store | 8 | 4 | 50% | 100% | checkout | url 3, http 1 | url 4, http 2, ui 2 |
| portal | 4 | 3 | 75% | 100% | — | url 2, ui 1 | url 3, ui 1 |

`checkout` is irreversible and was held by the publisher — the review gate
working. The missing store API ops were never exercised; `open_checkout` is a
static route and does not lift. The portal's `export_csv` needs download
capture.

Raw: [`compiled-dev.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/compiled-dev.md).

### 2.2 Held-out maps

| Site | Frozen version | Ops | Tiers |
|---|---:|---|---|
| library | 4 | search, get_book, borrow | url, url, ui |
| support | 5 | login, list_tickets, filter_tickets, paginate, create_ticket | ui, url, url, url, http |

The seed maps author states and signatures; the compiler fills impls from
fallback traces and verifies them on three fresh sessions. The freeze record
carries the base commit and the model.

Raw: [`freeze.json`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/freeze.json), [`maps/heldout/`](https://github.com/abubakarsiddik31/portolan/tree/main/maps/heldout).

### 2.3 N=3, Arm C, scripted model

48 rows: 16 held-out templates × 3 param sets.

| Arm | Runs | Templates | Success (95% CI) | $/completed (95% CI) | Steps/task (95% CI) |
|---|---:|---:|---|---|---|
| C | 48 | 16 | 100.0% (100.0–100.0) | $0.0000 ($0.0000–$0.0000) | 7.8 (6.4–9.3) |

The 100% and $0 are by construction: the scripted model is deterministic and
makes no billed calls. The number validates the harness, maps, backend, and
result schema. It says nothing about a model's success rate.

Raw: [`n3.jsonl`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/n3.jsonl), [`n3.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/n3.md),
[`n3-final-table.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/n3-final-table.md).

### 2.4 Drift, scripted model

| Op | v1 | after switch | after repair | tier |
|---|---|---|---|---|
| library.search | pass | fail | pass | url |
| support.login | pass | fail | pass | ui |
| support.create | pass | fail | pass | http |

- **Repair rate:** 100% (3/3)
- **Duplicate writes:** 0
- **Drift-day success:** 100%

The sample is three ops, one run, and the only write is `support.create`. No
idempotency key is retried, so a duplicate write is not possible in this run.
The semantic filter and paginate failures from the v2 fixtures are not in the
sample.

Raw: [`drift.json`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/drift.json), [`drift.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/drift.md).

### 2.5 Latency on the store fixture

| Op | Tier | p50 | p95 | Budget (p50) |
|---|---|---:|---:|---:|
| search | url | 8.4ms | 9.9ms | 150ms |
| get_product | url | 8.5ms | 11.1ms | 150ms |
| list_products_api | http | 1.0ms | 1.8ms | 150ms |
| get_product_api | http | 1.8ms | 2.1ms | 150ms |
| add_to_cart | ui | 25.4ms | 27.1ms | 500ms |

Raw: [`perf.json`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/perf.json), [`perf.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/perf.md).

### 2.6 Client conformance

| Client | Status | Detail |
|---|---|---|
| Claude Code | pass | `sites=3, op=search, ok=true` |
| Gemini CLI | pass | same |
| Codex CLI | fail | `402 Payment Required` (deactivated workspace) |

The server is `portolan mcp`, which launches Chromium, so `ok=true` means the
client reached a real `search` result through the `url` tier — not just the
MCP surface. The fixture is the store app on `127.0.0.1:4100`; the model is the
client's own, so this is a client-compatibility check, not a success-rate
measurement.

Raw: [`conformance.json`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/conformance.json),
[`conformance.md`](https://github.com/abubakarsiddik31/portolan/blob/main/bench/results/conformance.md).

## 3. What is missing

| Requirement | Why it is missing |
|---|---|
| Arm A (`agent-browser`) | No provider key; the baseline needs a model |
| Arm B (fallback with a model) | Same |
| Arm D (oracle) | The held-out maps exist; no oracle run with a model and billed usage |
| A second provider | Only `scripted` was configured |
| N=3 with billed usage | Every row is `$0` by construction |
| Real-model failures | No provider was called |
| Semantic drift (filter, paginate) | Not in the three-op sample |
| Idempotency retry on a write | Not exercised |

The local open-weights smoke test exists (`bench/local/open-weights.test.ts`)
and is skipped without `PORTOLAN_LOCAL_BASE_URL` and `PORTOLAN_LOCAL_MODEL`.
It is the smallest real-model check; it has not produced a committed row.

## 4. Gate status

| Gate | Pass condition | Status |
|---|---|---|
| G0 | perfect ops ≥3x fewer steps and ≥5x cheaper than `agent-browser` | **not run** |
| G1 | compiled maps ≥60% of the oracle win, ≥50% yield, break-even K≤3 | **not passed**; yield is 100%, the oracle denominator is missing |
| G2 | ≥80% repair, zero duplicate writes | **not a valid sample**; 3/3 scripted |

**The release gate stays closed.** v0.1.0 is not released on this evidence
(ADR-005). The artifacts above may be cited only as harness validations.

## 5. Reproduce

```bash
pnpm install
pnpm build

pnpm --filter @abubakarsiddiik/bench pilot        # 16 rows, scripted
pnpm --filter @abubakarsiddiik/bench n3           # 48 rows, scripted
pnpm --filter @abubakarsiddiik/bench drift        # v1 -> v2 repair, scripted
pnpm --filter @abubakarsiddiik/bench conformance  # MCP clients
pnpm --filter @abubakarsiddiik/bench perf         # latency
```

A real run needs `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (or an
OpenAI-compatible endpoint) and the same commands with a provider-backed
runner. The model port is configured per role; see
[`packages/model/src/config.ts`](https://github.com/abubakarsiddik31/portolan/blob/main/packages/model/src/config.ts).

## 6. Threats to validity

- **A deterministic model proves the harness, not the product.** The 100%
  success and 7.8 steps are properties of the script.
- **No oracle denominator.** G1 cannot be computed from a single arm.
- **Three drift ops is not a drift rate.** A 3/3 result has a wide interval;
  the semantic failures are absent.
- **The fixture is local and synchronous.** A real site adds network, auth,
  anti-bot, and dynamic content.
- **The latency sample is one machine and ten runs.** It shows the tier
  overhead, not a production p50.
- **Conformance is two clients and one op on a local fixture.** It shows the
  clients can drive the surface and reach a result; it is not a task sample.

## 7. What the next run must do

Per ADR-005: arms A, B, C, and D-oracle on the 16 held-out templates, two
providers, a model-Y transfer run, N=3 with billed usage, oracle rows, and a
drift run with real models including the semantic filter and paginate failures
and an idempotency-key retry. Until then the gates stay closed.
