import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActResult, SemanticNode, Snapshot } from "@abubakarsiddiik/substrate";
import { buildRefMap } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import type { RunEnvironment } from "./environments.js";
import { confineToOrigin, runCases } from "./runner.js";
import { parseCase, type QaCase } from "./spec.js";
import type { QaSubstrate, QaView } from "./types.js";

function node(id: number, role: string, name: string): SemanticNode {
  return {
    nodeId: `n${id}`,
    role,
    name,
    backendNodeId: id,
    ignored: false,
    visible: true,
    properties: {},
    childIds: [],
  };
}

class FakeSubstrate implements QaSubstrate {
  url = "http://app/sign-in";
  title = "Test";
  staleOnce = false;
  fillSticks = true;
  navigatesOnClick = true;
  private values = new Map<number, string>();

  private readonly nodes = [
    node(1, "textbox", "Email"),
    node(2, "textbox", "Password"),
    node(3, "button", "Login"),
  ];

  view(): Promise<QaView> {
    return Promise.resolve(this.state());
  }

  state(): QaView {
    const snapshot: Snapshot = {
      doc: 1,
      v: 1,
      url: this.url,
      title: this.title,
      nodes: this.nodes,
    };
    return { snapshot, refs: buildRefMap(this.nodes, 1) };
  }

  goto(url: string): Promise<QaView> {
    this.url = url;
    return Promise.resolve(this.state());
  }

  act(request: {
    ref: string;
    do: "click" | "check" | "uncheck" | "fill" | "select" | "press";
    value?: string;
  }): Promise<ActResult> {
    if (this.staleOnce) {
      this.staleOnce = false;
      return Promise.resolve({ ok: false, code: "stale_ref", current_doc: 1 });
    }

    const view = this.state();
    const entry = view.refs.byRef.get(request.ref);

    if (request.do === "fill" && entry !== undefined && this.fillSticks) {
      this.values.set(entry.backendNodeId, request.value ?? "");
    }

    if (request.do === "click" && entry?.name === "Login" && this.navigatesOnClick) {
      this.url = "http://app/dashboard";
    }

    return Promise.resolve({
      ok: true,
      doc: 1,
      v: 2,
      url: this.url,
      title: this.title,
      effects: [],
      delta: { navigation: false, entries: [] },
    });
  }

  read(ref?: string): Promise<{ text: string }> {
    if (ref === undefined) {
      return Promise.resolve({
        text: this.nodes.map((item) => item.name).join("\n"),
      });
    }

    const entry = this.state().refs.byRef.get(ref);
    if (entry === undefined) return Promise.resolve({ text: "" });
    return Promise.resolve({
      text: this.values.get(entry.backendNodeId) ?? entry.name,
    });
  }
}

function caseSpec(overrides: Record<string, unknown> = {}): QaCase {
  return parseCase({
    schema: 1,
    id: "auth/login",
    title: "Login",
    suite: "smoke",
    effect: "read",
    status: "draft",
    tags: ["smoke"],
    touches: ["src/auth/**"],
    routes: ["/sign-in"],
    steps: [{ goto: "/sign-in" }, { do: "click", target: { role: "button", name: "Login" } }],
    expect: [{ url: "/dashboard" }],
    ...overrides,
  });
}

function run(spec: QaCase, substrate: FakeSubstrate, trusted = [spec.id]) {
  return runCases({
    baseUrl: "http://app",
    cases: [spec],
    trusted,
    evidence: "none",
    // A check that fails is retried until this long, so keep a failing test short.
    timeoutMs: 150,
    createSubstrate: () => substrate,
  });
}

describe("runCases", () => {
  it("passes a case that reaches its assertion", async () => {
    const outcome = await run(caseSpec(), new FakeSubstrate());
    expect(outcome.summary).toEqual({ pass: 1, fail: 0, skip: 0, error: 0 });
    expect(outcome.results[0]?.status).toBe("pass");
  });

  it("skips an unverified case unless the caller allows it", async () => {
    const outcome = await run(caseSpec(), new FakeSubstrate(), []);
    expect(outcome.results[0]?.status).toBe("skip");
    expect(outcome.results[0]?.fail_code).toBe("unverified");
    expect(outcome.results[0]?.next).toEqual(["qa verify auth/login"]);
  });

  it("re-resolves and retries once after a stale ref", async () => {
    const fake = new FakeSubstrate();
    fake.staleOnce = true;
    const outcome = await run(caseSpec(), fake);
    expect(outcome.results[0]?.status).toBe("pass");
  });

  it("fails with value_lost when a fill does not stick", async () => {
    const fake = new FakeSubstrate();
    fake.fillSticks = false;

    const outcome = await run(
      caseSpec({
        steps: [
          { goto: "/sign-in" },
          { do: "fill", target: { role: "textbox", name: "Email" }, value: "a@b.test" },
        ],
        expect: [{ visible: { role: "textbox", name: "Email" } }],
      }),
      fake,
    );

    expect(outcome.results[0]?.status).toBe("fail");
    expect(outcome.results[0]?.fail_code).toBe("value_lost");
  });

  it("reports an assertion failure with expected and actual", async () => {
    const outcome = await run(caseSpec({ expect: [{ url: "/never" }] }), new FakeSubstrate());
    const result = outcome.results[0];
    expect(result?.status).toBe("fail");
    expect(result?.fail_code).toBe("assertion_failed");
    expect(result?.expected).toBe("/never");
    expect(result?.actual).toBe("/dashboard");
  });

  it("classifies a mixed repeat as flaky", async () => {
    let calls = 0;
    const outcome = await runCases({
      baseUrl: "http://app",
      cases: [caseSpec()],
      trusted: ["auth/login"],
      repeat: 2,
      evidence: "none",
      timeoutMs: 150,
      createSubstrate: () => {
        calls += 1;
        const fake = new FakeSubstrate();
        if (calls === 2) fake.navigatesOnClick = false;
        return fake;
      },
    });

    expect(outcome.results[0]?.fail_code).toBe("flaky");
  });
});

const ENVIRONMENT: RunEnvironment = {
  name: "qa",
  profile: "admin",
  baseUrl: "http://app",
  origin: "http://app",
  writes: false,
  storageState: "/sessions/qa/admin.json",
};

const SECRET = "hunter2-live-secret";
const fillSecret = (field: string) => ({
  do: "fill",
  target: { role: "textbox", name: field },
  value: "$" + "{env.QA_PASSWORD}",
});

describe("runCases, secrets", () => {
  it("scrubs a resolved secret from the result, events, and evidence", async () => {
    const fake = new FakeSubstrate();
    fake.fillSticks = false;
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-"));

    try {
      const outcome = await runCases({
        baseUrl: "http://app",
        cases: [
          caseSpec({
            steps: [{ goto: "/sign-in" }, fillSecret("Password")],
            expect: [{ visible: { role: "textbox", name: "Password" } }],
          }),
        ],
        trusted: ["auth/login"],
        evidence: "failures",
        evidenceRoot: root,
        runId: "r1",
        env: { QA_PASSWORD: SECRET },
        createSubstrate: () => fake,
      });

      const result = outcome.results[0];
      expect(result?.fail_code).toBe("value_lost");
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).toContain("[redacted]");

      const files = readdirSync(root, { recursive: true, encoding: "utf8" });
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        if (!/\.(json|jsonl|txt)$/.test(file)) continue;
        expect(readFileSync(join(root, file), "utf8")).not.toContain(SECRET);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an env placeholder in a goto, where it would leave the machine", async () => {
    const outcome = await runCases({
      baseUrl: "http://app",
      cases: [caseSpec({ steps: [{ goto: "/x?k=" + "$" + "{env.QA_PASSWORD}" }] })],
      trusted: ["auth/login"],
      evidence: "none",
      env: { QA_PASSWORD: SECRET },
      createSubstrate: () => new FakeSubstrate(),
    });

    expect(outcome.results[0]?.fail_code).toBe("invalid_request");
    expect(JSON.stringify(outcome.results[0])).not.toContain(SECRET);
  });
});

describe("runCases, environments", () => {
  function runIn(spec: QaCase, fake: FakeSubstrate, environment = ENVIRONMENT) {
    return runCases({
      baseUrl: environment.baseUrl,
      environment,
      cases: [spec],
      trusted: [spec.id],
      evidence: "none",
      env: { QA_PASSWORD: SECRET },
      createSubstrate: () => fake,
    });
  }

  it("opens the substrate with the session and a read-only network", async () => {
    const seen: unknown[] = [];
    await runCases({
      baseUrl: "http://app",
      environment: ENVIRONMENT,
      cases: [caseSpec()],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: (input) => {
        seen.push(input);
        return new FakeSubstrate();
      },
    });

    expect(seen[0]).toMatchObject({ storageState: "/sessions/qa/admin.json", readOnly: true });
  });

  it("does not make the network read-only when the environment allows writes", async () => {
    const seen: unknown[] = [];
    await runCases({
      baseUrl: "http://app",
      environment: { ...ENVIRONMENT, writes: true },
      cases: [caseSpec()],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: (input) => {
        seen.push(input);
        return new FakeSubstrate();
      },
    });

    expect(seen[0]).toMatchObject({ readOnly: false });
  });

  it("skips a write case in a read-only environment without opening a browser", async () => {
    let opened = 0;
    const outcome = await runCases({
      baseUrl: "http://app",
      environment: ENVIRONMENT,
      cases: [
        caseSpec({ effect: "irreversible", map: { site: "store", version: 1, op: "checkout" } }),
      ],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: () => {
        opened += 1;
        return new FakeSubstrate();
      },
    });

    expect(opened).toBe(0);
    expect(outcome.results[0]).toMatchObject({ status: "skip", fail_code: "precondition_failed" });
    expect(outcome.results[0]?.fail_reason).toMatch(/read-only/);
  });

  it("refuses a goto that leaves the environment origin", async () => {
    const outcome = await runIn(
      caseSpec({ steps: [{ goto: "https://prod.example.com/admin" }], expect: [] }),
      new FakeSubstrate(),
    );

    expect(outcome.results[0]?.fail_code).toBe("precondition_failed");
    expect(outcome.results[0]?.fail_reason).toMatch(/leaves the environment origin/);
  });

  it("fills a credential on the environment origin", async () => {
    const outcome = await runIn(
      caseSpec({
        steps: [{ goto: "/sign-in" }, fillSecret("Password")],
        expect: [],
      }),
      new FakeSubstrate(),
    );

    expect(outcome.results[0]?.status).toBe("pass");
  });

  it("refuses to type a credential on another origin", async () => {
    const fake = new FakeSubstrate();
    fake.url = "http://evil.test/sign-in";

    const outcome = await runIn(caseSpec({ steps: [fillSecret("Password")], expect: [] }), fake);

    expect(outcome.results[0]?.fail_code).toBe("precondition_failed");
    expect(outcome.results[0]?.fail_reason).toMatch(/bound to http:\/\/app/);
    expect(JSON.stringify(outcome.results[0])).not.toContain(SECRET);
  });

  it("adds no origin rule without an environment", async () => {
    const outcome = await run(
      caseSpec({ steps: [{ goto: "https://elsewhere.test/" }], expect: [] }),
      new FakeSubstrate(),
    );
    expect(outcome.results[0]?.status).toBe("pass");
  });
});

describe("scrubbing leaves structure alone", () => {
  it("does not rewrite the case id or status when a short secret matches them", async () => {
    const fake = new FakeSubstrate();
    fake.fillSticks = false;

    const outcome = await runCases({
      baseUrl: "http://app",
      cases: [
        caseSpec({
          id: "admin-login",
          steps: [{ goto: "/sign-in" }, fillSecret("Password")],
          expect: [{ visible: { role: "textbox", name: "Password" } }],
        }),
      ],
      trusted: ["admin-login"],
      evidence: "none",
      env: { QA_PASSWORD: "admin" },
      createSubstrate: () => fake,
    });

    const result = outcome.results[0];
    expect(result).toMatchObject({
      case_id: "admin-login",
      status: "fail",
      fail_code: "value_lost",
    });
    expect(outcome.summary).toEqual({ pass: 0, fail: 1, skip: 0, error: 0 });
    expect(JSON.stringify(result?.actual)).toContain("[redacted]");
    expect(JSON.stringify(result?.actual)).not.toContain("admin");
  });
});

describe("confineToOrigin", () => {
  function calls() {
    const seen: string[] = [];
    const base = {
      goto: (url: string) => {
        seen.push(`goto ${url}`);
        return Promise.resolve({});
      },
      fetch: (request: { url: string }) => {
        seen.push(`fetch ${request.url}`);
        return Promise.resolve({});
      },
      state: () => ({ marker: "state" }),
    };
    return {
      seen,
      substrate: confineToOrigin(base as never, "http://app") as never as typeof base,
    };
  }

  it("lets same-origin goto and fetch through and keeps other methods working", async () => {
    const { seen, substrate } = calls();
    await substrate.goto("http://app/x");
    await substrate.fetch({ url: "http://app/api" });
    expect(seen).toEqual(["goto http://app/x", "fetch http://app/api"]);
    expect(substrate.state()).toEqual({ marker: "state" });
  });

  it("refuses an off-origin goto or fetch, as a map op with an absolute route would make", () => {
    const { seen, substrate } = calls();
    expect(() => substrate.goto("https://evil.test/")).toThrow(/leaves the environment origin/);
    expect(() => substrate.fetch({ url: "https://evil.test/c?k=1" })).toThrow(
      /leaves the environment origin/,
    );
    expect(seen).toEqual([]);
  });
});

/** A page that renders late: its controls appear on the Nth capture. */
class LateSubstrate extends FakeSubstrate {
  captures = 0;
  extra: SemanticNode[] = [];
  appearAt = 3;
  disappearAt = Number.POSITIVE_INFINITY;
  dialog = false;
  shot = new Uint8Array([1, 2, 3]);

  override view(): Promise<QaView> {
    this.captures += 1;
    return Promise.resolve(this.state());
  }

  override state(): QaView {
    const base = super.state();
    const shown =
      this.captures >= this.appearAt && this.captures < this.disappearAt ? this.extra : [];
    const dialog = this.dialog ? [node(90, "dialog", "New API key")] : [];
    const nodes = [...base.snapshot.nodes, ...shown, ...dialog];
    return { snapshot: { ...base.snapshot, nodes }, refs: buildRefMap(nodes, 1) };
  }

  screenshot(): Promise<Uint8Array> {
    return Promise.resolve(this.shot);
  }
}

describe("checks that wait", () => {
  it("retries a check until the page renders, instead of failing on the first look", async () => {
    const late = new LateSubstrate();
    late.extra = [node(50, "heading", "Analytics")];

    const outcome = await runCases({
      baseUrl: "http://app",
      cases: [caseSpec({ expect: [{ visible: { role: "heading", name: "Analytics" } }] })],
      trusted: ["auth/login"],
      evidence: "none",
      timeoutMs: 2000,
      createSubstrate: () => late,
    });

    expect(outcome.results[0]?.status).toBe("pass");
    expect(late.captures).toBeGreaterThanOrEqual(3);
  });

  it("does not let absent pass on a page that has not rendered yet when the thing is there later", async () => {
    // The spinner is present for the first captures, then goes away.
    const late = new LateSubstrate();
    late.extra = [node(51, "progressbar", "Loading")];
    late.appearAt = 0;
    late.disappearAt = 4;

    const outcome = await runCases({
      baseUrl: "http://app",
      cases: [caseSpec({ expect: [{ absent: { role: "progressbar", name: "Loading" } }] })],
      trusted: ["auth/login"],
      evidence: "none",
      timeoutMs: 2000,
      createSubstrate: () => late,
    });

    expect(outcome.results[0]?.status).toBe("pass");
  });

  it("awaits visible, absent and value, and times out saying what it saw", async () => {
    const late = new LateSubstrate();
    late.extra = [node(52, "button", "Export")];

    const waits = await runCases({
      baseUrl: "http://app",
      cases: [
        caseSpec({
          steps: [
            { goto: "/sign-in" },
            { await: "visible", target: { role: "button", name: "Export" }, timeout_ms: 2000 },
            { await: "absent", target: { role: "dialog", name: "Nope" } },
          ],
          expect: [],
        }),
      ],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: () => late,
    });
    expect(waits.results[0]?.status).toBe("pass");

    const never = await runCases({
      baseUrl: "http://app",
      cases: [
        caseSpec({
          steps: [
            { goto: "/sign-in" },
            { await: "visible", target: { role: "button", name: "Missing" }, timeout_ms: 150 },
          ],
          expect: [],
        }),
      ],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: () => new LateSubstrate(),
    });
    expect(never.results[0]?.fail_code).toBe("timeout");
    expect(never.results[0]?.fail_reason).toContain("expected a locator to be visible");

    const incomplete = await runCases({
      baseUrl: "http://app",
      cases: [
        caseSpec({
          steps: [{ goto: "/sign-in" }, { await: "value", timeout_ms: 100 }],
          expect: [],
        }),
      ],
      trusted: ["auth/login"],
      evidence: "none",
      createSubstrate: () => new LateSubstrate(),
    });
    expect(incomplete.results[0]?.fail_reason).toContain("await value needs a target and equals");
  });
});

describe("failure evidence", () => {
  it("writes the page text, a screenshot when asked, and says a dialog scoped the read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portolan-qa-evidence-"));
    try {
      const late = new LateSubstrate();
      late.dialog = true;
      late.appearAt = Number.POSITIVE_INFINITY;

      const outcome = await runCases({
        baseUrl: "http://app",
        cases: [caseSpec({ expect: [{ text: { contains: "Never on the page" } }] })],
        trusted: ["auth/login"],
        evidence: "failures",
        evidenceRoot: dir,
        runId: "r1",
        screenshot: true,
        timeoutMs: 150,
        createSubstrate: () => late,
      });

      const evidence = outcome.results[0]?.evidence_dir;
      expect(evidence).toBeDefined();
      const files = readdirSync(evidence as string);
      expect(files).toEqual(
        expect.arrayContaining(["text.txt", "page.png", "result.json", "view.txt"]),
      );
      expect(readFileSync(join(evidence as string, "text.txt"), "utf8")).toContain("Email");
      const result = JSON.parse(readFileSync(join(evidence as string, "result.json"), "utf8"));
      expect(result.read_scope).toEqual({ scoped_to: "dialog", name: "New API key" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
