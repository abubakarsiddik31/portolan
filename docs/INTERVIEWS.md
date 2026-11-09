# Discovery interviews — T6.02

| | |
|---|---|
| **Date** | 2026-11-09 |
| **Task** | T6.02 — eight discovery interviews (compressed from 15) |
| **Target** | 2026-11-20 (two weeks) |
| **Input** | [Vertical scorecard](./VERTICALS.md) — interview procurement first, logistics second |
| **Output** | `docs/interviews/tracker.csv` + one paragraph of notes per call |

## 1. What this task must produce

T6.02 is not a sales call and not a demo. It exists to answer four questions per interview, and one more across all eight:

1. **Pain** — what specifically breaks in the workflow, and how often?
2. **Volume** — how many portals, opportunities, and submissions per month?
3. **Budget** — what do they already pay to solve this, and who signs?
4. **One workflow to test** — a concrete, repeatable task we could hand-write as ops.
5. **Across all eight:** is there one buyer segment with enough volume and budget to justify the vertical?

If the answer to 5 is no, T6.03 does not pick a vertical — it revisits the thesis. That is a valid outcome.

## 2. Who to talk to

**Primary: bid and proposal consultancies.** They manage many clients, feel portal pain daily, and already charge for the work. They are the most likely buyer.

**Secondary: small government contractors** (1–50 employees, 8(a)/SDVOSB/WOSB, GSA schedule holders). They feel the pain but may not have budget.

| Segment | Count | Titles |
|---|---|---|
| Bid/proposal consultancies | 5 | Owner, principal, capture manager, proposal manager |
| SMB government contractors | 3 | Owner, contracts manager, business development lead |

**Where to find them**

- LinkedIn: `"proposal manager" AND ("government contracting" OR govcon)`, `"bid consultant"`, `"capture manager"`
- APMP chapters (Association of Proposal Management Professionals) — local chapter events
- APEX Accelerators (formerly PTAC) and SBA district offices — they know the SMBs
- GovCon communities: r/govcon, LinkedIn GovCon groups, local chamber gov-contracting groups
- Referrals: ask every interviewee for one more name

**Do not** interview vendors selling into the space as if they were buyers. Their pain is not the buyer's pain.

## 3. Screener (send before booking)

Five questions. Disqualify if they do not touch portals weekly.

1. Do you personally search or submit on SAM.gov, state portals, or agency portals?
2. Roughly how many solicitations do you review in a month?
3. Roughly how many bids do you submit in a month?
4. Which portals do you use most?
5. Are you the person who decides whether to try a new tool?

## 4. Outreach

**LinkedIn connection request**

> Hi {name} — I'm researching how small govcon teams handle opportunity search and bid submission across SAM.gov and state portals. Not selling anything; I'm trying to understand where the time actually goes. Would you be open to 25 minutes?

**LinkedIn follow-up (after accept)**

> Thanks for connecting. I'm talking to bid and proposal folks about one thing: how much of a bid is portal mechanics versus writing the response. No pitch — I'll share what I learn from the other interviews. Would {two slots} work?

**Email**

> Subject: 25 min on govcon portal pain?
>
> Hi {name},
>
> I'm researching how small contractors and bid consultancies manage opportunity search, document downloads, and submissions across SAM.gov and state/local portals.
>
> I'm not selling a product. I'm trying to learn where the hours go and what breaks — deadlines, amendments, registration, portal-specific forms.
>
> Would you have 25 minutes in the next two weeks? I'll send a short summary of what I learn from the whole set.
>
> — {you}

**Referral ask (end of every call)**

> Is there one other person you'd suggest I talk to — someone who runs more bids than you do?

## 5. Interview script (25 minutes)

Keep it about their work, not our product. Do not describe Portolan until the last two minutes, if at all.

**Warm-up (2 min)**
- What does your company do, and what's your role?
- How did you get into govcon bidding?

**Current workflow (8 min)**
- Walk me through the last bid you submitted, start to finish.
- Where did you find the opportunity?
- What did you have to do in the portal itself?
- Who else touched it?

**Pain and volume (7 min)**
- How many portals do you check in a week? Which ones?
- How many opportunities reviewed vs. bids submitted per month?
- What share of the work is portal mechanics vs. writing?
- What breaks most: deadlines, amendments, Q&A, document versions, registration expiry?
- Tell me about the last time a portal cost you a bid.

**Budget and trust (5 min)**
- What do you pay today — consultants, bid software, VAs — and for what?
- Who signs off on a new tool, and what budget line does it come from?
- Would you let an agent submit a bid, or only draft it? What would you need to trust a submit?

**Close (3 min)**
- If one workflow were automated next month, which one?
- Can I follow up with a mockup of that workflow?
- Who else should I talk to?

## 6. What to capture

Fill one row per interview in [`docs/interviews/tracker.csv`](./interviews/tracker.csv). The columns that matter most:

| Field | Why |
|---|---|
| `portals_per_week` | Fragmentation, and whether a map library is worth building |
| `opps_per_month` / `bids_per_month` | Volume and the read/write ratio |
| `portal_time_pct` | How much of the job is mechanics, not writing |
| `current_spend` | Budget evidence |
| `trust_for_submit` | Whether the write-safety wedge is sellable |
| `workflow_to_test` | The concrete op set for T1.12 |
| `fit_score` (1–5) | Ranking for T6.03 |

Also write **one paragraph** per call: the sharpest quote, the biggest surprise, and whether it changed the scorecard.

## 7. Kill criteria

Stop and reassess if, after eight calls:

- Fewer than **three** people describe portal mechanics as a top-three time sink.
- Fewer than **three** can name a workflow they would pay to automate.
- Nobody can describe a **binding submission** they would trust an agent to perform, even with confirmation.
- The only interested buyers are consultancies with **<5 clients**, i.e. no volume.

Any two of these → T6.03 records "no vertical yet" and the plan revisits the thesis rather than forcing a choice.

## 8. Schedule

| Day | Action |
|---|---|
| Mon Nov 9 | Send 20 LinkedIn requests and 10 emails; book the first four |
| Tue–Wed Nov 10–11 | Run 4 interviews; log notes the same day |
| Thu Nov 12 | Send 15 more outreach; referrals from the first four |
| Fri Nov 13 | Run 2 interviews; mid-point check against kill criteria |
| Mon–Tue Nov 16–17 | Run final 2; send follow-ups |
| Wed Nov 18 | Fill tracker; rank segments |
| Thu Nov 19 | Draft ADR-006 input |
| Fri Nov 20 | T6.02 done; T6.03 decision |

## 9. Ethics and hygiene

- Ask permission before recording. If refused, take notes live.
- Do not ask for confidential bid content, pricing, or customer names.
- Do not promise a product, a price, or a timeline.
- Send the promised summary within a week.
- Keep contact details out of the repo; the tracker holds role and company type only.
