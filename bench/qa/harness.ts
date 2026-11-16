/**
 * The QA harness: the substrate patterns the careerkor live run proved out,
 * packaged for any site's regression pack.
 *
 * A pack is a list of test cases. The harness runs them one by one against
 * one substrate session, isolates failures, and renders results as markdown
 * with per-case evidence. The verbs are the same ones a hand-written driver
 * needs — settle-aware navigation, acts that retry through SPA re-renders,
 * fills that verify by readback — so a pack author writes assertions, not
 * infrastructure.
 */

import {
  type Affordance,
  PlaywrightEngine,
  rankAffordances,
  Substrate,
  type SubstrateView,
} from "@portolan/substrate";

export type Status = "pass" | "fail" | "skip";

export type CaseResult = {
  id: string;
  title: string;
  status: Status;
  evidence: string;
};

export type TestCase = {
  id: string;
  title: string;
  run: (ctx: Harness) => Promise<{ status: Status; evidence: string }>;
};

export type HarnessOptions = {
  /** Base URL every `gotoPage` path resolves against. */
  baseUrl: string;
  /** Settle budget handed to the substrate; default 8000 ms. */
  settleBudgetMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Harness {
  readonly s: Substrate;
  private readonly engine: PlaywrightEngine;
  private readonly baseUrl: string;

  private constructor(engine: PlaywrightEngine, substrate: Substrate, baseUrl: string) {
    this.engine = engine;
    this.s = substrate;
    this.baseUrl = baseUrl;
  }

  static async launch(
    executablePath: string,
    options: HarnessOptions,
    launchArgs: string[] = [],
  ): Promise<Harness> {
    const engine = await PlaywrightEngine.launch({ executablePath, launchArgs });
    const substrate = new Substrate(engine, { settleBudgetMs: options.settleBudgetMs ?? 8_000 });
    return new Harness(engine, substrate, options.baseUrl);
  }

  /** Wrap an existing substrate (tests, or a caller with its own engine). */
  static wrap(substrate: Substrate, baseUrl: string): Harness {
    return new Harness(
      { close: async () => {} } as unknown as PlaywrightEngine,
      substrate,
      baseUrl,
    );
  }

  /** Navigate relative to the pack's base URL and wait for the page to settle. */
  async gotoPage(path: string): Promise<SubstrateView> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const view = await this.s.goto(url);
    await this.untilStable();
    return this.s.state() ?? view;
  }

  /** The current page text, from visible accessible names. */
  async pageText(): Promise<string> {
    const read = await this.s.read();
    return read.text;
  }

  async close(): Promise<void> {
    await this.engine.close();
  }

  /** Poll the page text until it is unchanged twice, or the timeout hits. */
  private async untilStable(timeoutMs = 6_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      const text = await this.pageText();
      if (text.length > 0 && text === last) return;
      last = text;
      await sleep(500);
    }
  }
}

// ---- substrate helpers (the patterns the careerkor run proved) ----------

export function find(
  view: SubstrateView,
  pattern: RegExp,
  roles?: string[],
): Affordance | undefined {
  const { affordances } = rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 300 });
  return affordances.find(
    (a) => (roles === undefined || roles.includes(a.role)) && pattern.test(a.name),
  );
}

export function allAffordances(view: SubstrateView): Affordance[] {
  return rankAffordances(view.snapshot.nodes, { refs: view.refs, limit: 300 }).affordances;
}

/**
 * Act with retry: SPAs re-render between a snapshot and a dispatch, which
 * drops refs and leaves elements not-yet-interactive. Each attempt re-views,
 * re-finds the affordance by role and name, and follows the substrate's
 * `new_ref` suggestion when it offers one.
 */
export async function actRetry(
  harness: Harness,
  view: SubstrateView,
  affordance: Affordance | undefined,
  request: { do: "click" | "fill" | "press"; value?: string; verify?: boolean },
  label: string,
): Promise<{ view: SubstrateView; ok: boolean; note: string }> {
  if (affordance === undefined) {
    return { view, ok: false, note: `no affordance matched (${view.snapshot.url})` };
  }
  let result: Awaited<ReturnType<Substrate["act"]>> | undefined;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const currentView = attempt === 1 ? view : await harness.s.view();
    const target =
      attempt === 1
        ? affordance
        : find(
            currentView,
            new RegExp(`^${affordance.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
            [affordance.role],
          );
    if (target?.ref === undefined) break;
    try {
      result = await harness.s.act(
        {
          ref: target.ref,
          do: request.do,
          value: request.value,
          verify: request.verify,
          key: request.do === "press" ? request.value : undefined,
        },
        { recovery: true },
      );
    } catch (error) {
      console.log(`.. ${label}: engine threw (${(error as Error).message.slice(0, 80)})`);
      result = undefined;
    }
    if (result?.ok === true) {
      return {
        view: await harness.s.view(),
        ok: true,
        note: `${request.do} "${affordance.name}" -> ${result.url}`,
      };
    }
    if (result?.ok === false && result.code === "stale_ref" && result.new_ref !== undefined) {
      result = await harness.s.act({ ref: result.new_ref, do: request.do, value: request.value });
      if (result.ok) {
        return {
          view: await harness.s.view(),
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

/**
 * Fill and verify the value took. SPA re-renders can drop a fill dispatched
 * against a stale node; each attempt clicks to re-anchor the control first.
 * Depends on the substrate's readback; a site that reformats values needs an
 * exact-match-aware assertion instead.
 */
export async function fillSticky(
  harness: Harness,
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
      const clicked = await actRetry(harness, current, box, { do: "click" }, `${label} focus`);
      current = clicked.view;
    }
    const target = find(current, pattern, ["textbox"]);
    if (target === undefined) return current;
    const filled = await actRetry(
      harness,
      current,
      target,
      { do: "fill", value, verify: true },
      label,
    );
    current = filled.view;
    if (filled.ok) return current;
    const again = find(current, pattern, ["textbox"]);
    if (again?.ref !== undefined) {
      const read = await harness.s.read(again.ref);
      if (read.text === value) return current;
    }
    await sleep(1200);
  }
  console.log(`   !! ${label}: value did not stick`);
  return current;
}

// ---- orchestration -------------------------------------------------------

/**
 * Run cases one by one against one harness. A case that throws is a fail
 * with the error as evidence; the loop continues. The caller owns the
 * harness lifecycle: launch once for a suite that shares a login (the
 * careerkor run showed per-case logins trip rate limits), or call this per
 * harness when a case needs isolation.
 */
export async function runCases(cases: TestCase[], harness: Harness): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  for (const testCase of cases) {
    try {
      const outcome = await testCase.run(harness);
      results.push({ id: testCase.id, title: testCase.title, ...outcome });
    } catch (error) {
      results.push({
        id: testCase.id,
        title: testCase.title,
        status: "fail",
        evidence: `threw: ${(error as Error).message.slice(0, 200)}`,
      });
    }
  }

  return results;
}

export function summarize(results: CaseResult[]): string {
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;
  return `${pass} pass, ${fail} fail, ${skip} skip`;
}

export function renderMarkdown(results: CaseResult[], heading = "QA run — results"): string {
  const lines = [
    `# ${heading}`,
    "",
    "| ID | Test | Status | Evidence |",
    "|---|---|---|---|",
    ...results.map((r) => {
      const esc = (text: string) => text.replace(/\|/g, "\\|");
      return `| ${r.id} | ${esc(r.title)} | ${r.status.toUpperCase()} | ${esc(r.evidence)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
