/**
 * CareerKor regression run: executes docs/qa/careerkor/test-cases.md one by one.
 *
 * CHROME_PATH=... CK_EMAIL=... CK_PASS=... \
 *   pnpm --filter @abubakarsiddiik/bench exec tsx local/careerkor/run-tests.ts
 *
 * Credentials come from the environment and are never printed. Results go to
 * docs/qa/careerkor/results.md and stdout.
 */

import { writeFileSync } from "node:fs";
import {
  type Affordance,
  PlaywrightEngine,
  rankAffordances,
  Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";

const BASE = "https://careerkor.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status = "pass" | "fail" | "skip";
type Outcome = { id: string; title: string; status: Status; evidence: string };
const outcomes: Outcome[] = [];

function record(id: string, title: string, status: Status, evidence: string): void {
  outcomes.push({ id, title, status, evidence });
  const mark = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "SKIP";
  console.log(`${mark}  ${id}  ${title}`);
  if (evidence) console.log(`      ${evidence}`);
}

// ---- substrate helpers (same stack as explore.ts) ----------------------

function find(view: SubstrateView, pattern: RegExp, roles?: string[]): Affordance | undefined {
  const { affordances } = rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 300 });
  return affordances.find(
    (a) => (roles === undefined || roles.includes(a.role)) && pattern.test(a.name),
  );
}

function allAffs(view: SubstrateView): Affordance[] {
  return rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 300 }).affordances;
}

function countRoles(view: SubstrateView, roles: string[]): number {
  return allAffs(view).filter((a) => roles.includes(a.role)).length;
}

async function pageText(s: Substrate): Promise<string> {
  const read = await s.read();
  return read.text;
}

/** Navigate and wait for the SPA to settle: title set and text stable twice. */
async function gotoPage(s: Substrate, path: string): Promise<SubstrateView> {
  let view = await s.goto(`${BASE}${path}`);
  let lastLen = -1;
  for (let poll = 0; poll < 14; poll += 1) {
    const text = await pageText(s);
    const settled =
      view.snapshot.title !== "Loading" && text.length > 120 && text.length === lastLen;
    if (settled) return view;
    lastLen = text.length;
    await sleep(700);
    view = await s.view();
  }
  return view;
}

/** Act with retry: SPAs re-render and drop refs between snapshot and dispatch. */
async function act(
  s: Substrate,
  view: SubstrateView,
  affordance: Affordance | undefined,
  request: { do: "click" | "fill" | "press"; value?: string },
  label: string,
): Promise<{ view: SubstrateView; ok: boolean; note: string }> {
  if (affordance === undefined) {
    return { view, ok: false, note: `no affordance matched (${view.snapshot.url})` };
  }
  let result: Awaited<ReturnType<Substrate["act"]>> | undefined;
  let usedRef = affordance.ref;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const currentView = attempt === 1 ? view : await s.view();
    const target =
      attempt === 1
        ? affordance
        : find(
            currentView,
            new RegExp(`^${affordance.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
            [affordance.role],
          );
    if (target === undefined) break;
    usedRef = target.ref;
    if (usedRef === undefined) break;
    try {
      result = await s.act({
        ref: usedRef,
        do: request.do,
        value: request.value,
        key: request.do === "press" ? request.value : undefined,
      });
    } catch (error) {
      console.log(`.. ${label}: engine threw (${(error as Error).message.slice(0, 80)})`);
      result = undefined;
    }
    if (result?.ok === true) {
      return {
        view: await s.view(),
        ok: true,
        note: `${request.do} "${affordance.name}" -> ${result.url}`,
      };
    }
    if (result?.ok === false && result.code === "stale_ref" && result.new_ref !== undefined) {
      result = await s.act({
        ref: result.new_ref,
        do: request.do,
        value: request.value,
        key: request.do === "press" ? request.value : undefined,
      });
      if (result.ok) {
        return {
          view: await s.view(),
          ok: true,
          note: `${request.do} "${affordance.name}" -> ${result.url}`,
        };
      }
    }
    await sleep(1500);
  }
  return {
    view,
    ok: false,
    note: `act failed after retries: ${result && !result.ok ? result.code : "throw"}`,
  };
}

/** Fill and verify by readback; retry with click-to-focus. */
async function fillSticky(
  s: Substrate,
  view: SubstrateView,
  pattern: RegExp,
  value: string,
  label: string,
): Promise<SubstrateView> {
  let current = view;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const box = find(current, pattern, ["textbox"]);
    if (box === undefined) return current;
    if (attempt > 1) {
      const clicked = await act(s, current, box, { do: "click" }, `${label} focus`);
      current = clicked.view;
    }
    const target = find(current, pattern, ["textbox"]);
    if (target === undefined) return current;
    const filled = await act(s, current, target, { do: "fill", value }, label);
    current = filled.view;
    const again = find(current, pattern, ["textbox"]);
    if (again?.ref !== undefined) {
      const read = await s.read(again.ref);
      if (read.text === value) return current;
    }
    await sleep(1200);
  }
  console.log(`   !! ${label}: value did not stick`);
  return current;
}

async function waitFor(
  s: Substrate,
  pattern: RegExp,
  roles?: string[],
  timeoutMs = 20_000,
): Promise<SubstrateView> {
  const deadline = Date.now() + timeoutMs;
  let view = await s.view();
  while (Date.now() < deadline) {
    const hit = find(view, pattern, roles);
    if (hit !== undefined && view.snapshot.title !== "Loading") return view;
    await sleep(750);
    view = await s.view();
  }
  return view;
}

async function openSidebar(s: Substrate, view: SubstrateView): Promise<SubstrateView> {
  const toggle = find(view, /toggle sidebar/i, ["button"]);
  if (toggle === undefined) return view;
  await act(s, view, toggle, { do: "click" }, "open sidebar");
  await sleep(1200);
  return s.view();
}

const SIDEBAR_PAGES = [
  "Dashboard",
  "Jobs",
  "Application Tracker",
  "Resumes",
  "SOPs",
  "Cover Letters",
  "Profile",
  "ATS Score Checker",
  "Interview Coach",
  "Referrals",
  "Feedback",
];

const ROUTES = {
  Dashboard: "/dashboard",
  Jobs: "/jobs",
  "Application Tracker": "/applications",
  Resumes: "/resumes",
  SOPs: "/sops",
  "Cover Letters": "/cover-letters",
  Profile: "/profile",
  "ATS Score Checker": "/tools/ats-score",
  "Interview Coach": "/mock-interviews",
  Referrals: "/referrals",
  Feedback: "/reports",
} as const;

function routeOf(name: string): string {
  return ROUTES[name as keyof typeof ROUTES] ?? "/dashboard";
}

async function login(
  s: Substrate,
): Promise<{ view: SubstrateView; ok: boolean; evidence: string }> {
  let view = await gotoPage(s, "/sign-in");
  view = await waitFor(s, /^email$/i, ["textbox"]);
  const notes: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) {
      console.log("   login attempt 2 after 20s backoff");
      await sleep(20_000);
      view = await gotoPage(s, "/sign-in");
      view = await waitFor(s, /^email$/i, ["textbox"]);
    }
    view = await fillSticky(s, view, /^email$/i, process.env.CK_EMAIL ?? "", "email");
    view = await fillSticky(s, view, /^password$/i, process.env.CK_PASS ?? "", "password");
    const submitView = view;
    const submit =
      find(submitView, /^login$/i, ["button"]) ??
      allAffs(submitView).find(
        (a) =>
          a.role === "button" && /^(log ?in|sign ?in)$/i.test(a.name) && a.ctx?.includes("form"),
      );
    const clicked = await act(s, submitView, submit, { do: "click" }, "login submit");
    view = clicked.view;
    notes.push(clicked.note);
    await sleep(3000);
    view = await s.view();
    if (/dashboard/.test(view.snapshot.url)) {
      return { view, ok: true, evidence: notes.join("; ") };
    }
    const text = await pageText(s);
    notes.push(/invalid/i.test(text) ? "Invalid email shown" : "no error text");
  }
  return { view, ok: false, evidence: notes.join("; ") };
}

// ---- suites -------------------------------------------------------------

async function publicSuite(): Promise<void> {
  const engine = await PlaywrightEngine.launch({
    executablePath: process.env.CHROME_PATH as string,
  });
  const s = new Substrate(engine);

  // TC-PUB-01
  let view = await gotoPage(s, "/");
  const ctas = allAffs(view);
  const hasSignIn = ctas.some((a) => /sign in/i.test(a.name));
  const hasGetStarted = ctas.some((a) => /get started/i.test(a.name));
  record(
    "TC-PUB-01",
    "Landing renders",
    view.snapshot.title.includes("CareerKor") && hasSignIn && hasGetStarted ? "pass" : "fail",
    `title="${view.snapshot.title.slice(0, 60)}", CTAs: sign-in=${hasSignIn} get-started=${hasGetStarted}`,
  );

  // TC-PUB-02 — flaky header button; allow 2 tries and record cost
  const header = find(view, /^sign in$/i, ["button"]);
  let tries = 0;
  let landed = false;
  for (let attempt = 1; attempt <= 2 && header !== undefined; attempt += 1) {
    tries = attempt;
    const clicked = await act(s, view, header, { do: "click" }, `header Sign In #${attempt}`);
    view = clicked.view;
    await sleep(2500);
    view = await s.view();
    if (/sign-in/.test(view.snapshot.url)) {
      landed = true;
      break;
    }
  }
  record(
    "TC-PUB-02",
    "Header Sign In navigates",
    landed ? "pass" : "fail",
    landed
      ? `landed on /sign-in after ${tries} click(s)`
      : `still on ${view.snapshot.url} after ${tries} clicks`,
  );

  // TC-PUB-03
  view = await gotoPage(s, "/sign-in");
  view = await waitFor(s, /^email$/i, ["textbox"]);
  const formOk =
    find(view, /^email$/i, ["textbox"]) !== undefined &&
    find(view, /^password$/i, ["textbox"]) !== undefined &&
    find(view, /^login$/i, ["button"]) !== undefined &&
    find(view, /continue with google/i, ["button"]) !== undefined;
  record("TC-PUB-03", "Sign-in form renders", formOk ? "pass" : "fail", view.snapshot.url);

  // TC-PUB-04 — empty submit must show inline error
  const emptyResult = await act(
    s,
    view,
    find(view, /^login$/i, ["button"]),
    { do: "click" },
    "empty submit",
  );
  view = emptyResult.view;
  await sleep(1500);
  const emptyText = await pageText(s);
  const emptyError = /invalid|required|error|enter/i.test(emptyText);
  record(
    "TC-PUB-04",
    "Empty-submit validation",
    emptyError && /sign-in/.test(view.snapshot.url) ? "pass" : "fail",
    `error: ${emptyError ? "shown" : "none"}; url ${view.snapshot.url}`,
  );

  // TC-PUB-05 — wrong password rejected
  view = await gotoPage(s, "/sign-in");
  view = await waitFor(s, /^email$/i, ["textbox"]);
  view = await fillSticky(s, view, /^email$/i, process.env.CK_EMAIL ?? "", "email (wrong-pass)");
  view = await fillSticky(s, view, /^password$/i, "definitely-wrong-pass", "password (wrong)");
  const wrongResult = await act(
    s,
    view,
    find(view, /^login$/i, ["button"]),
    { do: "click" },
    "wrong-password submit",
  );
  view = wrongResult.view;
  await sleep(3000);
  view = await s.view();
  const wrongText = await pageText(s);
  const rejected = /invalid|incorrect|wrong|failed|error/i.test(wrongText);
  record(
    "TC-PUB-05",
    "Wrong-password rejection",
    rejected && /sign-in/.test(view.snapshot.url) ? "pass" : "fail",
    `error: ${rejected ? "shown" : "none"}; url ${view.snapshot.url}`,
  );

  // TC-PUB-06 — footer Forgot Password link target
  view = await gotoPage(s, "/");
  await sleep(1500);
  view = await s.view();
  const forgotResult = await act(
    s,
    view,
    find(view, /^forgot password$/i, ["link"]),
    { do: "click" },
    "footer forgot password",
  );
  view = forgotResult.view;
  await sleep(2000);
  view = await s.view();
  const resetUrl = view.snapshot.url;
  record(
    "TC-PUB-06",
    "Footer Forgot Password goes to reset flow",
    /forgot|reset|sign-in/i.test(resetUrl) && !/careerkor\.com\/?$/.test(resetUrl)
      ? "pass"
      : "fail",
    `landed on ${resetUrl}`,
  );

  await engine.close();
}

async function featuresSuite(s: Substrate, view: SubstrateView): Promise<SubstrateView> {
  // TC-JOB-01
  view = await gotoPage(s, ROUTES.Jobs);
  const jobOk =
    find(view, /^filters$/i, ["button"]) !== undefined &&
    find(view, /update job preferences/i, ["button"]) !== undefined;
  record(
    "TC-JOB-01",
    "Jobs page renders",
    jobOk ? "pass" : "fail",
    `filters=${find(view, /^filters$/i, ["button"]) !== undefined}, prefs=${find(view, /update job preferences/i, ["button"]) !== undefined}`,
  );

  // TC-JOB-02 — Filters opens filter controls
  const before = countRoles(view, ["textbox", "combobox", "checkbox"]);
  const filterClick = await act(
    s,
    view,
    find(view, /^filters$/i, ["button"]),
    { do: "click" },
    "filters",
  );
  view = filterClick.view;
  await sleep(1500);
  view = await s.view();
  const after = countRoles(view, ["textbox", "combobox", "checkbox"]);
  record(
    "TC-JOB-02",
    "Filters panel opens",
    filterClick.ok && after > before ? "pass" : "fail",
    `input controls ${before} -> ${after}`,
  );

  // TC-APP-01 — tracker lists existing items
  view = await gotoPage(s, ROUTES["Application Tracker"]);
  const appText = await pageText(s);
  const hasCards = /vercel|applied|interview/i.test(appText);
  record(
    "TC-APP-01",
    "Tracker lists applications",
    hasCards ? "pass" : "fail",
    hasCards ? "application cards present" : `text sample: ${appText.slice(0, 100)}`,
  );

  // TC-APP-02 — Add Application opens a form
  const addClick = await act(
    s,
    view,
    find(view, /^add application$/i, ["button"]),
    { do: "click" },
    "Add Application",
  );
  view = addClick.view;
  await sleep(1500);
  view = await s.view();
  const formBoxes = countRoles(view, ["textbox"]);
  record(
    "TC-APP-02",
    "Add Application opens form",
    addClick.ok && formBoxes > 0 ? "pass" : "fail",
    `${formBoxes} textboxes after click`,
  );

  // TC-APP-03 — guarded write: create + delete a labeled test application
  const companyBox = find(view, /company/i, ["textbox"]);
  const roleBox =
    find(view, /(position|job title|role)/i, ["textbox"]) ??
    allAffs(view).find((a) => a.role === "textbox" && !/company/i.test(a.name));
  const saveBtn = find(view, /^(save|add|create)( application)?$/i, ["button"]);
  if (companyBox === undefined || roleBox === undefined || saveBtn === undefined) {
    record(
      "TC-APP-03",
      "Add + remove test application",
      "skip",
      `form shape not confidently identified (company=${companyBox !== undefined}, role=${roleBox !== undefined}, save=${saveBtn !== undefined}); no write attempted`,
    );
  } else {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 12);
    view = await fillSticky(s, view, /company/i, "QA SMOKE", "company");
    view = await fillSticky(s, view, /(position|job title|role)/i, `QA SMOKE ${stamp}`, "role");
    const saveResult = await act(s, view, saveBtn, { do: "click" }, "save test application");
    view = saveResult.view;
    await sleep(2500);
    view = await s.view();
    const created = /QA SMOKE/i.test(await pageText(s));
    let removed = false;
    let cleanupNote = "";
    if (created) {
      // Delete only the QA SMOKE item: prefer a delete affordance near its card.
      const deleteBtn =
        find(view, /^delete$/i, ["button"]) ??
        find(view, /remove|trash/i, ["button"]) ??
        find(view, /^delete$/i, ["menuitem", "link"]);
      if (deleteBtn === undefined) {
        // Open the new card, then look again.
        const card = find(view, /QA SMOKE/i, ["button", "link"]);
        const openCard = await act(s, view, card, { do: "click" }, "open QA SMOKE card");
        view = openCard.view;
        await sleep(1500);
        view = await s.view();
        const deleteInView =
          find(view, /^delete$/i, ["button"]) ?? find(view, /remove|trash/i, ["button"]);
        const delResult = await act(s, view, deleteInView, { do: "click" }, "delete QA SMOKE");
        view = delResult.view;
        await sleep(2000);
        view = await s.view();
        const confirm = find(view, /^delete$/i, ["button"]);
        if (confirm !== undefined) {
          const confirmResult = await act(s, view, confirm, { do: "click" }, "confirm delete");
          view = confirmResult.view;
          await sleep(2000);
          view = await s.view();
        }
      } else {
        const delResult = await act(s, view, deleteBtn, { do: "click" }, "delete QA SMOKE");
        view = delResult.view;
        await sleep(2000);
        view = await s.view();
      }
      removed = !/QA SMOKE/i.test(await pageText(s));
      cleanupNote = removed ? "cleaned up" : "LEFTOVER QA SMOKE data — manual cleanup needed";
    } else {
      cleanupNote = "creation not visible in page text after save";
    }
    record(
      "TC-APP-03",
      "Add + remove test application",
      created && removed ? "pass" : "fail",
      `created=${created}; ${cleanupNote}`,
    );
  }

  // TC-RES-01
  view = await gotoPage(s, ROUTES.Resumes);
  const resOk =
    find(view, /create new resume/i, ["button"]) !== undefined &&
    find(view, /upload resume/i, ["button"]) !== undefined;
  record("TC-RES-01", "Resumes entry points", resOk ? "pass" : "fail", view.snapshot.url);

  // TC-RES-02 — editor opens, no save
  const resClick = await act(
    s,
    view,
    find(view, /create new resume/i, ["button"]),
    { do: "click" },
    "Create New Resume",
  );
  view = resClick.view;
  await sleep(2000);
  view = await s.view();
  record(
    "TC-RES-02",
    "Resume editor opens",
    resClick.ok && countRoles(view, ["textbox", "combobox"]) > 0 ? "pass" : "fail",
    `${countRoles(view, ["textbox", "combobox"])} input controls; url ${view.snapshot.url}`,
  );

  // TC-SOP-01 — existing draft integrity
  view = await gotoPage(s, ROUTES.SOPs);
  const sopText = await pageText(s);
  record(
    "TC-SOP-01",
    "SOP list integrity",
    /eth zurich/i.test(sopText) ? "pass" : "fail",
    /eth zurich/i.test(sopText) ? "ETH Zurich draft present" : "draft missing from list",
  );

  // TC-SOP-02 — new SOP form opens, no save
  const sopClick = await act(
    s,
    view,
    find(view, /create new sop/i, ["button"]),
    { do: "click" },
    "Create New SOP",
  );
  view = sopClick.view;
  await sleep(1500);
  view = await s.view();
  record(
    "TC-SOP-02",
    "New SOP form opens",
    sopClick.ok && countRoles(view, ["textbox", "combobox"]) > 0 ? "pass" : "fail",
    `${countRoles(view, ["textbox", "combobox"])} input controls; url ${view.snapshot.url}`,
  );

  // TC-CL-01 — cover letter list + entry point
  view = await gotoPage(s, ROUTES["Cover Letters"]);
  const clText = await pageText(s);
  const clOk = find(view, /create new cover letter/i, ["button"]) !== undefined;
  record(
    "TC-CL-01",
    "Cover letter list + entry point",
    clOk ? "pass" : "fail",
    `create button=${clOk}; draft present=${/vercel/i.test(clText)}`,
  );

  // TC-PRF-01 + TC-PRF-02 — profile form and extract entry point
  view = await gotoPage(s, ROUTES.Profile);
  await sleep(1000);
  view = await s.view();
  const saveChanges = find(view, /save changes/i, ["button"]);
  const extract = find(view, /extract from resume/i, ["button"]);
  record(
    "TC-PRF-01",
    "Profile form renders",
    saveChanges !== undefined ? "pass" : "fail",
    saveChanges !== undefined ? "Save Changes present" : "Save Changes absent",
  );
  record(
    "TC-PRF-02",
    "Extract from Resume present",
    extract !== undefined ? "pass" : "fail",
    extract !== undefined ? "present (not clicked — consumes AI credits)" : "absent",
  );

  // TC-ATS-01
  view = await gotoPage(s, ROUTES["ATS Score Checker"]);
  const atsOk =
    find(view, /run ats analysis/i, ["button"]) !== undefined &&
    find(view, /pick from my resumes/i, ["button"]) !== undefined;
  record("TC-ATS-01", "ATS checker renders", atsOk ? "pass" : "fail", view.snapshot.url);

  // TC-INT-01
  view = await gotoPage(s, ROUTES["Interview Coach"]);
  record(
    "TC-INT-01",
    "Interview coach renders",
    find(view, /start new interview/i, ["button"]) !== undefined ? "pass" : "fail",
    view.snapshot.url,
  );

  // TC-REF-01
  view = await gotoPage(s, ROUTES.Referrals);
  const refOk =
    find(view, /copy link/i, ["button"]) !== undefined &&
    find(view, /^share$/i, ["button"]) !== undefined;
  record("TC-REF-01", "Referrals render", refOk ? "pass" : "fail", view.snapshot.url);

  // TC-FDB-01 — empty bug report validation
  view = await gotoPage(s, ROUTES.Feedback);
  const fdbSubmit = find(view, /submit bug report/i, ["button"]);
  const fdbResult = await act(s, view, fdbSubmit, { do: "click" }, "empty bug report");
  view = fdbResult.view;
  await sleep(1500);
  const fdbText = await pageText(s);
  record(
    "TC-FDB-01",
    "Feedback form validation",
    /required|invalid|error|must|enter|please/i.test(fdbText) ? "pass" : "fail",
    /required|invalid|error|must|enter|please/i.test(fdbText)
      ? "validation shown"
      : "no validation on empty submit",
  );

  return view;
}

async function authedSuite(): Promise<void> {
  const engine = await PlaywrightEngine.launch({
    executablePath: process.env.CHROME_PATH as string,
  });
  const s = new Substrate(engine);

  // TC-AUTH-01 — valid login
  const login1 = await login(s);
  record(
    "TC-AUTH-01",
    "Valid login reaches dashboard",
    login1.ok ? "pass" : "fail",
    login1.ok ? login1.evidence : `${login1.evidence}; FINAL: did not reach /dashboard`,
  );
  let view = login1.view;

  if (!login1.ok) {
    const blocked: Array<[string, string]> = [
      ["TC-AUTH-02", "Dashboard is authenticated"],
      ["TC-NAV-01", "Sidebar complete"],
      ["TC-NAV-02", "Every sidebar page loads"],
      ["TC-NAV-03", "Titles are set"],
      ["TC-JOB-01", "Jobs page renders"],
      ["TC-JOB-02", "Filters panel opens"],
      ["TC-APP-01", "Tracker lists applications"],
      ["TC-APP-02", "Add Application opens form"],
      ["TC-APP-03", "Add + remove test application"],
      ["TC-RES-01", "Resumes entry points"],
      ["TC-RES-02", "Resume editor opens"],
      ["TC-SOP-01", "SOP list integrity"],
      ["TC-SOP-02", "New SOP form opens"],
      ["TC-CL-01", "Cover letter list + entry point"],
      ["TC-PRF-01", "Profile form renders"],
      ["TC-PRF-02", "Extract from Resume present"],
      ["TC-ATS-01", "ATS checker renders"],
      ["TC-INT-01", "Interview coach renders"],
      ["TC-REF-01", "Referrals render"],
      ["TC-FDB-01", "Feedback form validation"],
    ];
    for (const [id, title] of blocked) record(id, title, "skip", "login failed");
  } else {
    // TC-AUTH-02
    record(
      "TC-AUTH-02",
      "Dashboard is authenticated",
      find(view, /sign out/i, ["button"]) !== undefined ? "pass" : "fail",
      view.snapshot.url,
    );

    // TC-NAV-01 — sidebar completeness
    view = await openSidebar(s, view);
    const names = new Set(
      allAffs(view)
        .filter((a) => a.role === "link")
        .map((a) => a.name),
    );
    const missing = SIDEBAR_PAGES.filter((p) => !names.has(p));
    record(
      "TC-NAV-01",
      "Sidebar complete",
      missing.length === 0 ? "pass" : "fail",
      missing.length === 0
        ? `all ${SIDEBAR_PAGES.length} links present`
        : `missing: ${missing.join(", ")}`,
    );

    // TC-NAV-02 — walk every sidebar page via clicks
    const broken: string[] = [];
    for (const name of SIDEBAR_PAGES) {
      let hop = await gotoPage(s, ROUTES.Dashboard);
      hop = await openSidebar(s, hop);
      const target = find(hop, new RegExp(`^${name}$`), ["link"]);
      const clicked = await act(s, hop, target, { do: "click" }, `nav ${name}`);
      await sleep(2000);
      const landed = await s.view();
      const expected = `${BASE}${routeOf(name)}`;
      if (!clicked.ok || landed.snapshot.url !== expected) {
        broken.push(`${name} (landed ${landed.snapshot.url})`);
      }
    }
    record(
      "TC-NAV-02",
      "Every sidebar page loads",
      broken.length === 0 ? "pass" : "fail",
      broken.length === 0
        ? `all ${SIDEBAR_PAGES.length} navigated`
        : `problems: ${broken.join("; ")}`,
    );

    // TC-NAV-03 — titles via direct routes
    const emptyTitles: string[] = [];
    let count = 0;
    for (const [name, path] of Object.entries(ROUTES)) {
      const v = await gotoPage(s, path);
      if (v.snapshot.title.trim().length === 0) emptyTitles.push(name);
      count += 1;
      await sleep(300);
    }
    record(
      "TC-NAV-03",
      "Titles are set",
      emptyTitles.length === 0 ? "pass" : "fail",
      emptyTitles.length === 0
        ? `all ${count} non-empty`
        : `empty titles: ${emptyTitles.join(", ")}`,
    );

    // FEATURES suite (one login shared)
    view = await featuresSuite(s, view);

    // TC-AUTH-03 — sign out last: kills the session
    const outResult = await act(
      s,
      view,
      find(view, /sign out/i, ["button"]),
      { do: "click" },
      "sign out",
    );
    view = outResult.view;
    view = await waitFor(s, /^sign in$|^get started free$/i, ["button"], 10_000);
    const backToPublic =
      find(view, /sign in|get started/i, ["button"]) !== undefined &&
      find(view, /sign out/i, ["button"]) === undefined;
    record(
      "TC-AUTH-03",
      "Sign out returns to public state",
      backToPublic ? "pass" : "fail",
      `${view.snapshot.url}; sign-in affordance ${backToPublic ? "restored" : "absent"}`,
    );

    // TC-PUB-07 — auth guard after sign-out
    view = await gotoPage(s, "/dashboard");
    await sleep(2000);
    view = await s.view();
    const guarded =
      /sign-in|\/$/.test(view.snapshot.url) ||
      (find(view, /sign in|log in/i, ["button", "link"]) !== undefined &&
        find(view, /sign out/i, ["button"]) === undefined);
    record(
      "TC-PUB-07",
      "Auth guard redirects to sign-in",
      guarded ? "pass" : "fail",
      `goto /dashboard -> ${view.snapshot.url}`,
    );
  }

  await engine.close();
}

async function main(): Promise<void> {
  console.log("=== PUB suite (logged out) ===");
  await publicSuite();
  console.log("\n=== AUTH + NAV + FEATURES suites (one login) ===");
  await authedSuite();

  const pass = outcomes.filter((o) => o.status === "pass").length;
  const fail = outcomes.filter((o) => o.status === "fail").length;
  const skip = outcomes.filter((o) => o.status === "skip").length;
  console.log(`\n=== ${pass} pass, ${fail} fail, ${skip} skip ===`);

  const lines = [
    "# CareerKor QA run — results",
    "",
    "| | |",
    "|---|---|",
    `| **Date** | ${new Date().toISOString().slice(0, 10)} |`,
    "| **Runner** | Portolan substrate (affordance views + typed acts), one assertion per test case |",
    `| **Result** | ${pass} pass, ${fail} fail, ${skip} skip |`,
    "",
    "| ID | Test | Status | Evidence |",
    "|---|---|---|---|",
    ...outcomes.map(
      (o) =>
        `| ${o.id} | ${o.title} | ${o.status.toUpperCase()} | ${o.evidence.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  writeFileSync(
    new URL("../../../docs/qa/careerkor/results.md", import.meta.url).pathname,
    lines.join("\n"),
  );
  console.log("results written to docs/qa/careerkor/results.md");
}

await main();
process.exit(outcomes.some((o) => o.status === "fail") ? 1 : 0);
