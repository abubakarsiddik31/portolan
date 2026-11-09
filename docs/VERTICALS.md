# Vertical scorecard — T6.01

| | |
|---|---|
| **Date** | 2026-11-09 |
| **Task** | T6.01 — score three candidate verticals |
| **Status** | Complete. Input to T6.02 (interviews) and T6.03 (ADR-006) |
| **Decision rule** | Score, then interview. This document ranks candidates; it does **not** choose one. |

## 1. What is being scored

ADR-002 says the product is a verified map library for **one** vertical. ADR-009 says the only active work is G0 on that vertical. So the question is not "which market is biggest." It is:

> In which vertical can we hand-write 3–5 ops, recruit three design partners, and measure `agent-browser` vs. ops with a real model **by 2026-11-30**, in a workflow where write safety is worth paying for?

Size matters only after that. A large market we cannot test in three weeks is a distraction.

## 2. Scoring rubric

Each dimension is scored 1–5 and weighted. Weights encode the G0-first constraint: feasibility and reachability outrank market size.

| Dimension | Weight | 1 (bad) | 5 (good) |
|---|---|---|---|
| **G0 feasibility** | 25 | Needs PHI, regulated credentials, or terms that forbid automation; no test accounts | Public pages, self-serve accounts, no PHI, safe to measure without a binding action |
| **Repeat volume** | 20 | A few actions per year | Daily, per-patient or per-load volume |
| **Write risk** | 20 | Read-only; nothing at stake | Binding writes (submit, book, tender) where a duplicate costs money |
| **Buyer reachability** | 15 | Enterprise gatekeepers, 6-month cycles | SMB operators reachable in two weeks, pain is loud and public |
| **Budget** | 10 | No line item | Existing spend on labor or software for this exact task |
| **Map value** | 10 | One standard API already covers it | Fragmented portals with **no** standard API, so a UI map is the only integration |

**Why "map value" penalizes standard APIs.** If a workflow already runs over EDI or a clean API, a UI map is a worse integration than the API. The map thesis only pays where the site *is* the interface. This is the dimension that separates the three candidates most sharply.

## 3. Candidate A — Insurance eligibility (healthcare RCM)

**The workflow.** A practice verifies coverage, copay, deductible, and prior-auth requirements for every patient on the schedule, often by logging into many payer portals.

**Evidence**

- A public capability matrix lists **79** payer, clearinghouse, Medicare, Medicaid, and utilization-management portals; **64** accept a prior authorization online. A practice may log into **~12** in one verification session. [high]
- Manual prior authorization is quoted at **$10.97** per transaction direct, rising to **$50–150** all-in with rework and appeals; one estimate is **~$24.5k/year per physician** in direct admin cost. [medium — vendor analyses, not peer-reviewed]
- The RCM market is **$73.6B in 2026 → $132.1B by 2031** (MarketsandMarkets); AI prior-auth automation is **$0.95B in 2026 → $8.6B by 2034** (Fortune Business Insights). [medium — market-research vendors]
- Eligibility already has a national standard: **X12 270/271**. Prior auth is less standardized but heavily regulated. [high]

**Scores**

| Dimension | Score | Why |
|---|---|---|
| G0 feasibility | **1** | Payer portals require real provider credentials and PHI. A benchmark needs a BAA, synthetic patients, and payer terms that may forbid automation. Three partners in two weeks is unlikely. |
| Repeat volume | **5** | Every patient, every visit, every day. |
| Write risk | **3** | Eligibility is a read; prior auth is a write, but compliance dominates the risk model. |
| Buyer reachability | **2** | Practice managers are reachable, but compliance review and procurement slow everything down. |
| Budget | **5** | Large, proven spend on this exact labor. |
| Map value | **4** | 79 portals is real fragmentation, but 270/271 already covers the read path. |
| **Weighted** | **61 / 100** | |

**Verdict.** The biggest pain and the worst gate. It is the market to enter *after* the runtime is proven, not the one to prove it on. HIPAA alone would turn a 3-week G0 into a 3-month compliance project.

## 4. Candidate B — Procurement portals (SMB government contractors)

**The workflow.** A small contractor or bid consultancy monitors SAM.gov and state/local portals for opportunities, pulls solicitation documents, checks registration and set-aside eligibility, and submits a response before a hard deadline.

**Evidence**

- Federal opportunity data is centralized in **SAM.gov**, but state and local procurement is fragmented across state portals, agency sites, and hosted platforms (Bonfire, Jaggaer, Coupa, Ivalua). A bid shop routinely works dozens of portals. [medium — structural, not a single citation]
- Government procurement software is estimated at **$1.5B–$3.2B in 2026** (two vendors disagree), growing ~10–11% CAGR. [low — conflicting vendor reports]
- The pain is public and specific: missed deadlines, amendment/Q&A versions, registration expiry, and portal-specific submission rules. Bid/proposal consultancies exist as a paid service, which proves willingness to pay. [medium]
- There is **no standard API** for submitting a bid. Each portal has its own forms, document requirements, and confirmation flow. [high]

**Scores**

| Dimension | Score | Why |
|---|---|---|
| G0 feasibility | **4** | Public listings, self-serve accounts, no PHI. Measure search → open → download → **draft**; do not auto-submit during the benchmark. |
| Repeat volume | **4** | Daily monitoring; several submissions per month per contractor, more for a consultancy. |
| Write risk | **5** | A bid submission is binding, deadline-bound, and duplicate submission is a real loss. This is the write-safety wedge. |
| Buyer reachability | **5** | SMB contractors, 8(a)/SDVOSB firms, and bid consultants are easy to find and vocal about the pain. |
| Budget | **3** | Price-sensitive SMBs, but high value per won contract and existing spend on consultants. |
| Map value | **5** | Fragmented portals with no standard submission API. The site *is* the interface. |
| **Weighted** | **87 / 100** | |

**Verdict.** Best fit for G0. The only candidate where the measured workflow is safe to run publicly, the buyer is reachable in days, and the write risk is exactly what the runtime was built to govern.

## 5. Candidate C — Logistics carriers

**The workflow.** A brokerage or 3PL onboards carriers, tenders loads, books pickup/delivery appointments, and updates tracking across shipper, carrier, facility, and load-board portals.

**Evidence**

- Carrier onboarding today stitches together **FMCSA/SAFER lookups, FMC checks, fuel surcharge portals, and spreadsheets** — manual, per-carrier work. [medium — vendor blog, consistent with industry practice]
- Appointment scheduling is facility-specific: each warehouse or DC has its own portal, channel, and confirmation state; tools like Haulia exist specifically to automate it. [medium]
- Freight broker software is estimated at **$2.5B (2024) to $5.1B**, depending on the vendor. [low — conflicting reports]
- Freight already runs on **EDI (204/214/990)** and TMS/load-board APIs. The portal path exists mainly where a facility or small shipper has no API. [high]

**Scores**

| Dimension | Score | Why |
|---|---|---|
| G0 feasibility | **3** | No PHI, but accounts are partner-provisioned and some portals have anti-bot controls. |
| Repeat volume | **5** | Loads and appointments are daily. |
| Write risk | **5** | Tendering a load or double-booking a dock is immediate money. |
| Buyer reachability | **4** | Brokerage and 3PL ops managers are reachable and active. |
| Budget | **4** | Real software spend, clear ops ROI. |
| Map value | **3** | Fragmented, but EDI and TMS APIs already cover much of the workflow. |
| **Weighted** | **81 / 100** | |

**Verdict.** Strong second. The write risk and volume are excellent, but the industry's API/EDI rails reduce the marginal value of a UI map, and test access is harder than procurement.

## 6. Comparison

| | Insurance eligibility | Procurement portals | Logistics carriers |
|---|---|---|---|
| Weighted score | 61 | **87** | 81 |
| G0 feasible by 2026-11-30 | No (PHI, BAA) | **Yes** | Maybe |
| Portals per customer | ~12 | Dozens | Dozens |
| Standard API already exists | 270/271 | **No** | EDI + TMS |
| Write is binding | Prior auth | **Bid submission** | Tender / appointment |
| 3 partners in 2 weeks | Unlikely | **Likely** | Possible |
| Main risk | Compliance | Low ACV | API substitution |

## 7. Recommendation for T6.02

**Interview procurement first, logistics second, insurance only if the first two fail.**

The reasoning is the gate, not the market:

1. **Procurement is the only candidate where G0 can be measured honestly in three weeks.** Public listings, self-serve accounts, no PHI, and a measured workflow that stops at *draft* rather than a binding submission.
2. **It has the strongest write-safety story.** A duplicate or late bid submission is a concrete, expensive failure — exactly the scenario `unknown_outcome`, idempotency, and confirmation exist for.
3. **It has the weakest API substitute.** Insurance has 270/271; logistics has EDI. Procurement has no standard submission API, so the map is the integration.
4. **Buyers are reachable.** SMB contractors and bid consultants can be recruited without a compliance review.

The known weakness is **ACV**. SMB contractors are price-sensitive. T6.02 must test whether a bid consultancy — which manages many clients and already charges for this work — is the real buyer, not the single contractor.

## 8. G0 workflows to hand-write (procurement)

These are candidates for T1.12. Measure to **draft**; gate submission behind explicit confirmation and do not auto-submit in the benchmark.

| # | Op | Kind | Baseline (`agent-browser`) |
|---|---|---|---|
| 1 | `search_opportunities(naics, keywords, set_aside, state, due_after)` | read | Navigate portal, open search, set filters, page results, read titles |
| 2 | `get_opportunity(id)` | read | Open each result, scroll, extract deadline, agency, NAICS, attachments |
| 3 | `download_solicitation(id)` | read | Find attachment links, download each, handle popups |
| 4 | `check_registration(uei)` | read | Log in, navigate registration, read status and expiry |
| 5 | `draft_bid(opportunity_id, answers)` | write (draft) | Open response form, fill every field, save draft |
| 6 | `submit_bid(...)` | write (gated) | Final submit with confirmation — **not** measured in G0 |

## 9. Questions T6.02 must answer

Per interview, capture pain, volume, budget, and **one workflow to test**:

1. How many portals do you check in a week, and which ones?
2. How many opportunities reviewed vs. bids submitted per month?
3. What share of bid time is portal mechanics vs. writing the response?
4. What breaks most: deadlines, amendments, Q&A, document versions, registration expiry?
5. Would you let an agent submit, or only draft? What would you need to trust a submit?
6. What do you pay today — consultants, bid software, virtual assistants — and for what?
7. Who signs off on a new tool, and what is the budget line?
8. If one workflow were automated next month, which one?

## 10. What would change this recommendation

- **Interviews reveal procurement ACV is too low to support a business** → shift to logistics, where ops budgets are larger.
- **Procurement portals turn out to forbid automation broadly** → G0 feasibility drops; re-score.
- **A partner offers payer-portal access with a BAA already in place** → insurance becomes feasible and its 5 on budget dominates.
- **Logistics partners offer test accounts and the workflow is facility appointments** (not EDI-covered) → logistics map value rises from 3 to 4–5.

## 11. Sources

Accessed 2026-11-09. Confidence labels above reflect source type, not just recency.

- Asteroid, *Payer Portal Capability Matrix 2026* — 79 portals, 64 with online prior auth. https://asteroid.ai/market-maps/payer-portals/
- MarketsandMarkets, *RCM Market* — $73.61B (2026) → $132.06B (2031). https://www.marketsandmarkets.com/core/PressReleases/revenue-cycle-management
- Fortune Business Insights, *AI-based Prior Authorization Automation* — $950.6M (2026) → $8.6B (2034). https://www.fortunebusinessinsights.com/ai-based-prior-authorization-automation-market-118733
- azhec.org, *Manual Prior Authorization: The Real Workflow Cost* — $10.97 direct, $50–150 all-in. https://azhec.org/practice-operations/practice-workflow/manual-prior-authorization-workflow-costs
- Nirmitee, *The True Cost of Prior Authorization* — ~$24,529/physician/year. https://nirmitee.io/blog/true-cost-prior-authorization-data-driven-analysis-cms-ama-caqh/
- Agentman, *12 Payer Portals, Zero Logins* — ~12 portals per verification session. https://agentman.ai/blog/43-billion-eligibility-verification-tax-independent-practice-automation
- GlobalGrowthInsights / BusinessResearchInsights, *Government Procurement Software Market* — $1.48B–$3.19B (2026), ~10–11% CAGR. (Conflicting estimates; treat as a range.)
- FreightPulse, *Accelerating Carrier Onboarding with API-Driven Validation* — FMCSA/SAFER, FMC, fuel surcharge portals. https://freightpulsehq.com/blog/accelerating-carrier-onboarding-with-api-driven-validation-a-practical-guide-for-3pl-providers-using-freightpulse
- Haulia, *Automated Freight Appointment Scheduling* — facility-specific appointment channels. https://www.haulia.ai/use-cases/appointment-scheduling
- WiseGuy / VerifiedMarketReports, *Freight Broker Software Market* — $2.51B (2024) vs. $5.1B. (Conflicting; treat as a range.)
