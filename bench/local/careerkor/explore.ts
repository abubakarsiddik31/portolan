/**
 * Live-site QA exploration through the substrate: learn the app, page by page.
 *
 * Usage:
 *   CK_EMAIL=... CK_PASS=... \
 *   CHROME_PATH=~/.cache/ms-playwright/chromium_headless_shell-1254/chrome-linux/headless_shell \
 *   pnpm --filter @abubakarsiddiik/bench exec tsx local/careerkor/explore.ts [phase]
 *
 * phase: "public" (default) | "auth" | "tour"
 * Credentials are read from the environment and never printed.
 */

import {
  type Affordance,
  estimateTokens,
  PlaywrightEngine,
  rankAffordances,
  renderAffordances,
  Substrate,
  type SubstrateView,
} from "@abubakarsiddiik/substrate";

const BASE = "https://careerkor.com";

function chromePath(): string {
  if (process.env.CHROME_PATH !== undefined) return process.env.CHROME_PATH;
  throw new Error("set CHROME_PATH");
}

function find(view: SubstrateView, pattern: RegExp, roles?: string[]): Affordance | undefined {
  const { affordances } = rankAffordances(view.snapshot.nodes, {
    refs: view.refs,
    limit: 200,
  });
  return affordances.find(
    (a) => (roles === undefined || roles.includes(a.role)) && pattern.test(a.name),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until a textbox/link/button matching `pattern` appears. */
async function waitFor(
  s: Substrate,
  pattern: RegExp,
  roles?: string[],
  timeoutMs = 30_000,
): Promise<SubstrateView> {
  const deadline = Date.now() + timeoutMs;
  let view = await s.view();
  while (Date.now() < deadline) {
    const hit = find(view, pattern, roles);
    const settled = view.snapshot.title !== "Loading";
    if (hit !== undefined && settled) return view;
    await sleep(750);
    view = await s.view();
  }
  console.log(
    `!! waitFor ${pattern}: timed out (title "${view.snapshot.title}", url ${view.snapshot.url})`,
  );
  return view;
}

function show(view: SubstrateView, label: string, limit = 40): void {
  const { affordances, omitted } = rankAffordances(view.snapshot.nodes, {
    refs: view.refs,
    limit,
  });
  const rendered = renderAffordances(affordances);
  console.log(`\n=== ${label} ===`);
  console.log(`url: ${view.snapshot.url}`);
  console.log(`title: ${view.snapshot.title}  doc=${view.snapshot.doc}`);
  console.log(
    `observation: ${estimateTokens(rendered.text)} tokens (limit ${limit}, omitted ${omitted})`,
  );
  console.log(rendered.text);
}

async function act(
  s: Substrate,
  view: SubstrateView,
  affordance: Affordance | undefined,
  request: { do: "click" | "fill" | "press"; value?: string },
  label: string,
): Promise<SubstrateView> {
  if (affordance === undefined) {
    console.log(
      `\n!! ${label}: no affordance matched (url ${view.snapshot.url}, title "${view.snapshot.title}")`,
    );
    return view;
  }
  if (affordance.ref === undefined) {
    console.log(`\n!! ${label}: affordance "${affordance.name}" has no ref`);
    return view;
  }

  // Hydrating SPAs: elements can be non-interactive or re-rendered for a
  // few seconds after load. Retry with a fresh view between attempts.
  let result: Awaited<ReturnType<Substrate["act"]>> | undefined;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const currentView = attempt === 1 ? view : await s.view();
    const target =
      attempt === 1
        ? affordance
        : (find(
            currentView,
            new RegExp(`^${affordance.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
            [affordance.role],
          ) ?? affordance);
    if (target.ref === undefined) break;
    try {
      result = await s.act({
        ref: target.ref,
        do: request.do,
        value: request.value,
        key: request.do === "press" ? request.value : undefined,
      });
    } catch (error) {
      console.log(`.. ${label}: engine threw (${(error as Error).message.slice(0, 90)})`);
      result = undefined;
    }
    if (result?.ok === true) break;
    if (result?.ok === false && result.code === "stale_ref" && result.new_ref !== undefined) {
      result = await s.act({
        ref: result.new_ref,
        do: request.do,
        value: request.value,
        key: request.do === "press" ? request.value : undefined,
      });
      if (result.ok) break;
    }
    console.log(
      `.. ${label}: attempt ${attempt} failed${result && !result.ok ? ` (${result.code})` : ""}`,
    );
    await sleep(1500);
  }

  if (result === undefined || !result.ok) {
    console.log(`\n!! ${label}: act failed after retries`, result);
    return view;
  }
  const effects = result.effects
    .map((e) => (e.kind === "navigation" ? `nav→${e.to}` : e.kind))
    .join(",");
  console.log(
    `\n-- ${label}: ${request.do} on "${affordance.name}" [${affordance.ref}] → ${result.url} (effects: ${effects || "none"})`,
  );
  for (const e of result.effects) {
    if (e.kind === "network" && /\/api\//.test(e.url)) {
      console.log(
        `   net: ${e.method} ${e.url.slice(0, 140)} status=${e.status ?? "?"} req=${JSON.stringify(e.request_body)?.slice(0, 140)} res=${JSON.stringify(e.response_body)?.slice(0, 300)}`,
      );
    }
  }
  const after = await s.view();
  return after;
}

/**
 * Fill a textbox and verify the value stuck via readback; retry with a
 * click-to-focus first. SPA re-renders and re-routes can drop a fill that
 * was dispatched against a stale node.
 */
async function fillSticky(
  s: Substrate,
  pattern: RegExp,
  value: string,
  label: string,
): Promise<SubstrateView> {
  let view = await s.view();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const box = find(view, pattern, ["textbox"]);
    if (box?.ref === undefined) {
      console.log(`\n!! ${label}: textbox not found`);
      return view;
    }
    if (attempt > 1) {
      await s.act({ ref: box.ref, do: "click" });
      view = await s.view();
    }
    const target = find(view, pattern, ["textbox"]);
    if (target?.ref === undefined) return view;
    view = await act(s, view, target, { do: "fill", value }, `${label} (attempt ${attempt})`);
    const current = find(view, pattern, ["textbox"]);
    if (current?.ref !== undefined) {
      const read = await s.read(current.ref);
      const stuck = read.text === value;
      console.log(
        `   ${label} readback: ${stuck ? "OK" : `MISMATCH (${read.text === value ? "ok" : `${read.text.length} chars vs ${value.length}`})`}`,
      );
      if (stuck) return view;
    }
    await sleep(1200);
  }
  console.log(`\n!! ${label}: value did not stick after 3 attempts`);
  return view;
}

const phase = process.argv[2] ?? "public";
const engine = await PlaywrightEngine.launch({ executablePath: chromePath() });
const s = new Substrate(engine);
let view = await s.goto(BASE);
show(view, "landing", 50);

if (phase === "public") {
  // Look for every entry point into the app.
  const links = rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 200 });
  console.log(`\n=== all affordances on landing (${links.affordances.length}) ===`);
  for (const a of links.affordances) {
    console.log(`  ${a.role.padEnd(9)} ${(a.ctx ? `${a.ctx} › ` : "") + a.name}  [${a.ref}]`);
  }
}

if (phase === "auth" || phase === "tour") {
  // Enter deterministically: the header Sign In button is flaky mid-hydration
  // (TC-AUTH-01 covers that; the functional login tests go straight to the route).
  view = await s.goto(`${BASE}/sign-in`);
  view = await waitFor(s, /^email$/i, ["textbox"]);
  show(view, "login page", 30);

  view = await fillSticky(s, /^email$/i, process.env.CK_EMAIL ?? "", "email");
  view = await fillSticky(s, /^password$/i, process.env.CK_PASS ?? "", "password");

  // Submit; on "Invalid email" back off and retry — correct credentials
  // were accepted in earlier runs, so this smells like rate limiting or a
  // success-path race. Up to 3 attempts, 20s apart.
  let loggedIn = /dashboard/.test(view.snapshot.url);
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt += 1) {
    if (attempt > 1) {
      console.log(`\n-- login attempt ${attempt}: backing off 20s, retrying`);
      await sleep(20_000);
      view = await s.goto(`${BASE}/sign-in`);
      view = await waitFor(s, /^email$/i, ["textbox"]);
      view = await fillSticky(s, /^email$/i, process.env.CK_EMAIL ?? "", "email");
      view = await fillSticky(s, /^password$/i, process.env.CK_PASS ?? "", "password");
    }
    const submitView = view;
    const submitBtn =
      find(submitView, /^login$/i, ["button"]) ??
      rankAffordances(submitView.snapshot.nodes, {
        refs: submitView.refs,
        limit: 200,
      }).affordances.find(
        (a) =>
          a.role === "button" && /^(log ?in|sign ?in)$/i.test(a.name) && a.ctx?.includes("form"),
      );
    view = await act(
      s,
      submitView,
      submitBtn,
      { do: "click" },
      `submit login (attempt ${attempt})`,
    );
    await sleep(3000);
    view = await s.view();
    loggedIn = /dashboard/.test(view.snapshot.url);
    if (!loggedIn) {
      const text = await s.read();
      const errorLine = text.text
        .split("\n")
        .filter((line) =>
          /error|invalid|incorrect|wrong|failed|credential|try again|locked|too many/i.test(line),
        )
        .join(" | ");
      console.log(
        `   attempt ${attempt} landed on ${view.snapshot.url}; error text: ${errorLine || "(none)"}`,
      );
    }
  }
  show(view, loggedIn ? "after login" : "login failed", 50);
}

if (phase === "tour") {
  // Open the sidebar if it is collapsed, then walk each named sidebar page.
  const sidebar = find(view, /toggle sidebar/i, ["button"]);
  if (sidebar !== undefined) {
    view = await act(s, view, sidebar, { do: "click" }, "open sidebar");
  }
  await sleep(1500);
  view = await s.view();
  show(view, "dashboard with sidebar", 60);

  // Collect unique sidebar link NAMES once; resolve refs fresh at every hop
  // (refs are document-scoped and die on navigation).
  const { affordances } = rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 300 });
  const linkNames = [
    ...new Set(
      affordances
        .filter((a) => a.role === "link" && a.ctx?.includes("listitem"))
        .map((a) => a.name),
    ),
  ];
  const seen = new Set<string>([view.snapshot.url]);
  const homeUrl = view.snapshot.url;
  for (const name of linkNames) {
    view = await s.goto(homeUrl);
    await sleep(1200);
    const toggle = find(view, /toggle sidebar/i, ["button"]);
    if (toggle !== undefined) {
      view = await act(s, view, toggle, { do: "click" }, "sidebar open");
      await sleep(1200);
    }
    const fresh = await s.view();
    const target = find(fresh, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), [
      "link",
    ]);
    if (target === undefined) {
      console.log(`!! tour: "${name}" not found after re-render`);
      continue;
    }
    await act(s, fresh, target, { do: "click" }, `nav "${name}"`);
    await sleep(2000);
    const landed = await s.view();
    if (!seen.has(landed.snapshot.url)) {
      seen.add(landed.snapshot.url);
      show(landed, `page: ${name}`, 30);
    }
  }
  console.log(`\n=== tour visited ${seen.size} unique urls ===`);
  for (const url of seen) console.log(`  ${url}`);
}

await engine.close();
