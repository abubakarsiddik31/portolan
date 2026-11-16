# CareerKor QA run — results

| | |
|---|---|
| **Date** | 2026-11-16 |
| **Runner** | Portolan substrate (affordance views + typed acts), one assertion per test case |
| **Result** | 27 pass, 1 fail, 1 skip |

| ID | Test | Status | Evidence |
|---|---|---|---|
| TC-PUB-01 | Landing renders | PASS | title="CareerKor - AI Resume Builder, ATS Checker, and Interview Co", CTAs: sign-in=true get-started=true |
| TC-PUB-02 | Header Sign In navigates | PASS | landed on /sign-in after 1 click(s) |
| TC-PUB-03 | Sign-in form renders | PASS | https://careerkor.com/sign-in |
| TC-PUB-04 | Empty-submit validation | PASS | error: shown; url https://careerkor.com/sign-in |
| TC-PUB-05 | Wrong-password rejection | PASS | error: shown; url https://careerkor.com/sign-in |
| TC-PUB-06 | Footer Forgot Password goes to reset flow | PASS | landed on https://careerkor.com/forgot-password |
| TC-AUTH-01 | Valid login reaches dashboard | PASS | click "Login" -> https://careerkor.com/sign-in |
| TC-AUTH-02 | Dashboard is authenticated | PASS | https://careerkor.com/dashboard |
| TC-NAV-01 | Sidebar complete | PASS | all 11 links present |
| TC-NAV-02 | Every sidebar page loads | PASS | all 11 navigated |
| TC-NAV-03 | Titles are set | FAIL | empty titles: Dashboard, Profile, Feedback |
| TC-JOB-01 | Jobs page renders | PASS | filters=true, prefs=true |
| TC-JOB-02 | Filters panel opens | PASS | input controls 1 -> 16 |
| TC-APP-01 | Tracker lists applications | PASS | application cards present |
| TC-APP-02 | Add Application opens form | PASS | 4 textboxes after click |
| TC-APP-03 | Add + remove test application | SKIP | form shape not confidently identified (company=false, role=true, save=true); no write attempted |
| TC-RES-01 | Resumes entry points | PASS | https://careerkor.com/resumes |
| TC-RES-02 | Resume editor opens | PASS | 3 input controls; url https://careerkor.com/resumes |
| TC-SOP-01 | SOP list integrity | PASS | ETH Zurich draft present |
| TC-SOP-02 | New SOP form opens | PASS | 7 input controls; url https://careerkor.com/sops |
| TC-CL-01 | Cover letter list + entry point | PASS | create button=true; draft present=true |
| TC-PRF-01 | Profile form renders | PASS | Save Changes present |
| TC-PRF-02 | Extract from Resume present | PASS | present (not clicked — consumes AI credits) |
| TC-ATS-01 | ATS checker renders | PASS | https://careerkor.com/tools/ats-score |
| TC-INT-01 | Interview coach renders | PASS | https://careerkor.com/mock-interviews |
| TC-REF-01 | Referrals render | PASS | https://careerkor.com/referrals |
| TC-FDB-01 | Feedback form validation | PASS | validation shown |
| TC-AUTH-03 | Sign out returns to public state | PASS | https://careerkor.com/sign-in; sign-in affordance restored |
| TC-PUB-07 | Auth guard redirects to sign-in | PASS | goto /dashboard -> https://careerkor.com/sign-in?redirect=%2Fdashboard |
