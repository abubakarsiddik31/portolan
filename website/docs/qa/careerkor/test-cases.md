# CareerKor QA — test cases

| | |
|---|---|
| **Site** | https://careerkor.com |
| **Account** | AppSumo test account (credentials via `CK_EMAIL` / `CK_PASS` env; never committed) |
| **Method** | Portolan substrate: accessibility-tree views with refs, typed acts, readback verification. One session per suite, tests run one by one in listed order. |
| **Learned** | Feature inventory from the 2026-11-16 substrate tour: dashboard, jobs, application tracker, resumes, SOPs, cover letters, profile, ATS checker, interview coach, referrals, feedback. |
| **Write policy** | Only one labeled write test (creates a test application, then deletes it). No edits or deletions of existing data (the account holds real items: a Vercel application, an ETH Zurich SOP draft, a Vercel cover letter draft). |

## Suites and cases

### Suite PUB — logged out

| ID | Test | Steps | Expected |
|---|---|---|---|
| TC-PUB-01 | Landing renders | `goto /`, read view | Title contains "CareerKor"; hero CTAs (`Sign In`, `Get Started Free`) present |
| TC-PUB-02 | Header Sign In navigates | Click header `Sign In` | URL becomes `/sign-in`. *Known flaky: click can be lost mid-hydration; allow 2 tries and record how many it took* |
| TC-PUB-03 | Sign-in form renders | `goto /sign-in`, wait for form | `Email` + `Password` textboxes, `Login`, `Continue with Google` |
| TC-PUB-04 | Empty-submit validation | Click `Login` with empty fields | Inline error appears; no navigation |
| TC-PUB-05 | Wrong-password rejection | Fill valid email + wrong password, submit | Error text appears; stays on `/sign-in` |
| TC-PUB-06 | Footer Forgot Password link | Click footer `Forgot Password` | Lands on a password-reset page. *Suspect: appears to navigate to `/` instead* |
| TC-PUB-07 | Auth guard | `goto /dashboard` while logged out | Redirect to `/sign-in` (or landing), not dashboard content |

### Suite AUTH — login lifecycle

| ID | Test | Steps | Expected |
|---|---|---|---|
| TC-AUTH-01 | Valid login | Fill verified-by-readback credentials, click form `Login` | `POST /api/v1/auth/sign-in` fires; URL becomes `/dashboard`. *Known flaky: can full-reload back to `/sign-in` with "Invalid email" despite correct credentials; allow 2 tries* |
| TC-AUTH-02 | Dashboard is authenticated | Read `/dashboard` | `Sign out` affordance present |
| TC-AUTH-03 | Sign out | Click `Sign out` | Returns to public state; `/dashboard` no longer shows account content |

### Suite NAV — authenticated navigation and page health

| ID | Test | Steps | Expected |
|---|---|---|---|
| TC-NAV-01 | Sidebar complete | Open sidebar on `/dashboard` | Links: Dashboard, Jobs, Application Tracker, Resumes, SOPs, Cover Letters, Profile, ATS Score Checker, Interview Coach, Referrals, Feedback |
| TC-NAV-02 | Every sidebar page loads | Click each sidebar link, wait for settle | Each lands on its route with HTTP content (non-"Loading" title) |
| TC-NAV-03 | Titles are set | Read `<title>` on all 11 pages | Non-empty, feature-named. *Known failures: `/dashboard`, `/profile`, `/reports` render empty titles* |

### Suite FEATURES — per-feature smoke (one assertion each)

| ID | Test | Steps | Expected |
|---|---|---|---|
| TC-JOB-01 | Jobs page renders | Open `/jobs` | `Filters` and `Update Job Preferences` buttons present |
| TC-JOB-02 | Filters open | Click `Filters` | Filter controls (textbox/combobox/checkbox) appear |
| TC-APP-01 | Tracker lists items | Open `/applications` | ≥1 application card (the Vercel record) |
| TC-APP-02 | Add Application opens | Click `Add Application` | Form fields appear |
| TC-APP-03 | Add + remove test application (WRITE) | Create "QA SMOKE &lt;timestamp>" application; verify card; delete it | Card appears, then is gone; pre-existing data untouched |
| TC-RES-01 | Resumes entry points | Open `/resumes` | `Create New Resume`, `Upload Resume`, `AI Resume`, `Browse Templates` present |
| TC-RES-02 | Resume editor opens | Click `Create New Resume` | Editor or wizard form appears; **no save** |
| TC-SOP-01 | SOP list integrity | Open `/sops` | The "MSc Computer Science, ETH Zurich" draft is listed |
| TC-SOP-02 | New SOP form opens | Click `Create New SOP` | Form appears; **no save** |
| TC-CL-01 | Cover letter list integrity | Open `/cover-letters` | The Vercel draft is listed; `Create New Cover Letter` present |
| TC-PRF-01 | Profile form renders | Open `/profile` | Tabs render; `General Information` panel has `Save Changes` |
| TC-PRF-02 | Extract from Resume present | Open `/profile` | `Extract from Resume` button present (not clicked — consumes AI credits) |
| TC-ATS-01 | ATS checker renders | Open `/tools/ats-score` | `Run ATS Analysis`, `Pick from my resumes`, `Import from application` present |
| TC-INT-01 | Interview coach renders | Open `/mock-interviews` | `Start New Interview` present |
| TC-REF-01 | Referrals render | Open `/referrals` | `Copy link`, `Share` present |
| TC-FDB-01 | Feedback form validation | Open `/reports`, submit empty bug report | Inline validation appears |
| TC-FDB-02 | Feedback title | Read `<title>` on `/reports` | Non-empty. *Known failure* |

## Known findings entering the run (from exploration)

1. Header `Sign In` click intermittently lost mid-hydration — observed in 2 of 5 exploration runs; passed first-try in the recorded run. Timing-dependent; watch it in CI.
2. Valid-credential login intermittently reloads to `/sign-in` showing "Invalid email" (1 of 4 exploration runs) — success-path race or rate limiting with a misleading message; passed first-try in the recorded run.
3. "Invalid email" error is shown when the email field is empty — message should distinguish required vs invalid (TC-PUB-04 passes on "an error appears"; the message quality is the finding).
4. **Confirmed in the recorded run:** empty `<title>` on `/dashboard`, `/profile`, `/reports` (TC-NAV-03 FAIL).
5. Sign-in form does not submit on Enter in the password field.
6. ~~Footer `Forgot Password` appears to navigate to `/`~~ — cleared by TC-PUB-06: it lands on `/forgot-password` as expected; the earlier observation was an exploration-script artifact.

TC-APP-03 (write test) safely skipped: the Add Application form does not expose a "Company" textbox; the runner refuses to write to a form shape it cannot identify confidently. Extend the matcher after inspecting the form labels to enable the create+cleanup path.
