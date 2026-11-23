import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ActResult, SemanticNode, Snapshot } from "@abubakarsiddiik/substrate";
import { buildRefMap } from "@abubakarsiddiik/substrate";
import { describe, expect, it } from "vitest";

import { mergeQaConfig } from "./config.js";
import { authStatePath, parseEnvironments } from "./environments.js";
import { QaService } from "./service.js";
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

/** A local app whose submit button answers to `buttonName`. */
class FakeApp implements QaSubstrate {
  url = "http://app/sign-in";
  title = "Test";
  private readonly values = new Map<number, string>();

  constructor(private readonly buttonName: string) {}

  private get nodes(): SemanticNode[] {
    return [
      node(1, "textbox", "Email"),
      node(2, "textbox", "Password"),
      node(3, "button", this.buttonName),
    ];
  }

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
    const entry = this.state().refs.byRef.get(request.ref);

    if (request.do === "fill" && entry !== undefined) {
      this.values.set(entry.backendNodeId, request.value ?? "");
    }

    if (request.do === "click" && entry?.name === this.buttonName) {
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
      return Promise.resolve({ text: this.nodes.map((item) => item.name).join("\n") });
    }
    const entry = this.state().refs.byRef.get(ref);
    if (entry === undefined) return Promise.resolve({ text: "" });
    return Promise.resolve({ text: this.values.get(entry.backendNodeId) ?? entry.name });
  }
}

function makeService(createSubstrate: () => QaSubstrate): QaService {
  const root = mkdtempSync(join(tmpdir(), "portolan-qa-service-"));
  const config = mergeQaConfig(root, { baseUrl: "http://app", database: ":memory:" });
  return new QaService(config, { createSubstrate });
}

function loginCase(overrides: Record<string, unknown> = {}): QaCase {
  return parseCase({
    schema: 1,
    id: "auth/login",
    title: "Login",
    suite: "smoke",
    effect: "read",
    status: "draft",
    tags: ["smoke"],
    touches: [],
    routes: ["/sign-in"],
    steps: [
      { goto: "/sign-in" },
      { do: "fill", target: { role: "textbox", name: "Email" }, value: "a@b.test" },
      { do: "fill", target: { role: "textbox", name: "Password" }, value: "secret" },
      { do: "click", target: { role: "button", name: "Login" } },
    ],
    expect: [{ url: "/dashboard" }],
    ...overrides,
  });
}

describe("QaService.generate", () => {
  it("writes a normalized draft from a loose spec", () => {
    const service = makeService(() => new FakeApp("Login"));

    const report = service.generate({
      fromSpec: {
        title: "Login flow",
        steps: [{ goto: "/sign-in" }, { do: "click", target: { role: "button", name: "Login" } }],
        expect: [{ url: "/dashboard" }],
      },
    });

    expect(report.case_id).toBe("login-flow");
    expect(report.path).toContain("login-flow.json");
    expect(report.next[0]).toBe("qa verify login-flow");

    const written = parseCase(JSON.parse(readFileSync(report.path, "utf8")) as unknown);
    expect(written.status).toBe("draft");
    expect(service.list().map((row) => row.id)).toContain("login-flow");
    service.close();
  });

  it("generates a draft from a trace file", () => {
    const service = makeService(() => new FakeApp("Login"));

    const tracePath = join(service.config.root, "trace.json");
    writeFileSync(
      tracePath,
      JSON.stringify({
        scope_id: "scope-9",
        sid: "s1",
        intent: "open the jobs page",
        effect: "read",
        started_at: "2026-11-17T00:00:00.000Z",
        entries: [{ kind: "view", at: "t0", doc: 1, v: 1, url: "http://app/jobs", affordances: 3 }],
      }),
      "utf8",
    );

    const report = service.generate({ fromTracePath: tracePath });

    expect(report.case_id).toBe("open-the-jobs-page");
    expect(report.spec.steps).toEqual([{ goto: "/jobs" }]);
    expect(report.spec.source).toEqual({ kind: "trace", trace_id: "scope-9" });
    service.close();
  });

  it("refuses to overwrite an existing case and demands an input", () => {
    const service = makeService(() => new FakeApp("Login"));
    service.generate({ fromSpec: { title: "Login flow", steps: [{ goto: "/a" }] } });

    expect(() =>
      service.generate({ fromSpec: { title: "Login flow", steps: [{ goto: "/a" }] } }),
    ).toThrowError(/already exists/);
    expect(() => service.generate({})).toThrowError(/from_spec or from_trace/);
    service.close();
  });
});

describe("QaService.repair", () => {
  it("recovers a renamed target, writes a draft, and confirms the fix", async () => {
    const service = makeService(() => new FakeApp("Login now"));
    service.caseWrite(loginCase());

    const failed = await service.run(
      { ids: ["auth/login"] },
      { allowUnverified: true, trigger: "manual" },
    );
    expect(failed.summary).toEqual({ pass: 0, fail: 1, skip: 0, error: 0 });
    expect(failed.results[0]?.fail_code).toBe("not_found");
    expect(failed.results[0]?.fail_step).toBe(3);

    const report = await service.repair({ caseId: "auth/login" });

    expect(report.repaired).toBe(true);
    expect(report.changes).toEqual([
      {
        phase: "step",
        index: 3,
        from: { role: "button", name: "Login" },
        to: { role: "button", name: "Login now" },
      },
    ]);
    expect(report.confirmation?.status).toBe("pass");
    expect(report.next).toEqual(["qa verify auth/login"]);

    const written = parseCase(
      JSON.parse(readFileSync(join(service.config.cases, "auth", "login.json"), "utf8")) as unknown,
    );
    expect(written.steps[3]).toEqual({
      do: "click",
      target: { role: "button", name: "Login now" },
    });
    expect(written.status).toBe("draft");
    service.close();
  });

  it("reports a transient failure without editing the case", async () => {
    let renamed = true;
    const service = makeService(() => (renamed ? new FakeApp("Login now") : new FakeApp("Login")));
    service.caseWrite(loginCase());

    const failed = await service.run(
      { ids: ["auth/login"] },
      { allowUnverified: true, trigger: "manual" },
    );
    expect(failed.summary.fail).toBe(1);

    renamed = false;
    const report = await service.repair({ caseId: "auth/login" });

    expect(report.repaired).toBe(false);
    expect(report.reason).toContain("transient");
    expect(report.changes).toEqual([]);

    const untouched = parseCase(
      JSON.parse(readFileSync(join(service.config.cases, "auth", "login.json"), "utf8")) as unknown,
    );
    expect(untouched.steps[3]).toEqual({ do: "click", target: { role: "button", name: "Login" } });
    service.close();
  });

  it("refuses a non-locator failure", async () => {
    const service = makeService(() => new FakeApp("Login"));
    service.caseWrite(loginCase({ expect: [{ url: "/never" }] }));

    const failed = await service.run(
      { ids: ["auth/login"] },
      { allowUnverified: true, trigger: "manual" },
    );
    expect(failed.results[0]?.fail_code).toBe("assertion_failed");

    const report = await service.repair({ caseId: "auth/login", fromRun: failed.run_id });
    expect(report.repaired).toBe(false);
    expect(report.reason).toContain("not a locator failure");
    service.close();
  });

  it("reports when there is nothing to repair from", async () => {
    const service = makeService(() => new FakeApp("Login"));
    service.caseWrite(loginCase());

    const report = await service.repair({ caseId: "auth/login" });
    expect(report.repaired).toBe(false);
    expect(report.reason).toContain("no failed run recorded");
    service.close();
  });
});

describe("QaService.select", () => {
  it("explains that a suite needs its own file and offers --tag", () => {
    const service = makeService(() => new FakeApp("Login"));

    expect(() => service.select({ suite: "permissions" })).toThrow(
      /\.portolan\/qa\/suites\/permissions\.json/,
    );
    expect(() => service.select({ suite: "permissions" })).toThrow(/--tag permissions/);

    service.close();
  });
});

describe("QaService environments", () => {
  function envService(createSubstrate: Parameters<typeof makeEnvService>[0]) {
    return makeEnvService(createSubstrate);
  }

  function makeEnvService(createSubstrate: (input: Record<string, unknown>) => QaSubstrate) {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-service-"));
    const home = mkdtempSync(join(tmpdir(), "portolan-qa-home-"));
    const config = {
      ...mergeQaConfig(root, { baseUrl: "http://app", database: ":memory:" }),
      environments: parseEnvironments({
        qa: { baseUrl: "http://qa.app.test", profiles: ["admin"] },
        prod: { baseUrl: "http://app.test", profiles: ["readonly", "admin"] },
      }),
    };
    const service = new QaService(config, {
      createSubstrate: createSubstrate as never,
      home,
    });
    const save = (env: string, profile: string): string => {
      const path = authStatePath(root, env, profile, home);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{}");
      return path;
    };
    return { service, save, home };
  }

  function seedLogin(service: QaService): void {
    service.caseWrite(loginCase({ steps: [{ goto: "/sign-in" }], expect: [], status: "draft" }));
  }

  it("runs as the named environment with its saved session", async () => {
    const seen: Record<string, unknown>[] = [];
    const { service, save } = envService((input) => {
      seen.push(input);
      return new FakeApp("Login");
    });
    const session = save("qa", "admin");
    seedLogin(service);

    const result = await service.run({ ids: ["auth/login"] }, { env: "qa", allowUnverified: true });

    expect(result.summary.pass).toBe(1);
    expect(seen[0]).toMatchObject({
      baseUrl: "http://qa.app.test",
      storageState: session,
      readOnly: true,
    });
  });

  it("returns a typed auth_missing error naming the command a person runs", async () => {
    const { service } = envService(() => new FakeApp("Login"));
    seedLogin(service);

    await expect(service.run({ ids: ["auth/login"] }, { env: "qa" })).rejects.toMatchObject({
      code: "auth_missing",
      details: { next: ["portolan auth login --env qa --profile admin"] },
    });
  });

  it("refuses an unconfigured environment", async () => {
    const { service } = envService(() => new FakeApp("Login"));
    await expect(service.run({}, { env: "staging" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("points a failed environment run at the sign-in command", async () => {
    const { service, save } = envService(() => new FakeApp("Login"));
    save("qa", "admin");
    service.caseWrite(
      loginCase({ steps: [{ goto: "/sign-in" }], expect: [{ url: "/dashboard" }] }),
    );

    const result = await service.run({ ids: ["auth/login"] }, { env: "qa", allowUnverified: true });

    expect(result.results[0]?.status).toBe("fail");
    expect(result.results[0]?.next?.join("\n")).toMatch(
      /portolan auth login --env qa --profile admin/,
    );
  });

  it("keeps a case id that holds a redacted word, and still redacts secrets", async () => {
    const { service, save } = envService(() => new FakeApp("Login"));
    save("qa", "admin");
    service.caseWrite(
      loginCase({
        id: "auth/wrong-password-shows-error",
        steps: [{ goto: "/sign-in" }],
        expect: [{ url: "/dashboard" }],
      }),
    );

    const result = await service.run(
      { ids: ["auth/wrong-password-shows-error"] },
      { env: "qa", allowUnverified: true },
    );

    const only = result.results[0];
    expect(only?.case_id).toBe("auth/wrong-password-shows-error");
    expect(JSON.stringify(only)).not.toContain("wrong-[redacted]");
    expect(only?.next?.join("\n")).toContain("auth/wrong-password-shows-error");
  });

  it("does not mark a case broken when a read-only environment refuses it", async () => {
    const { service, save } = envService(() => new FakeApp("Login"));
    save("prod", "readonly");
    service.caseWrite(
      loginCase({
        id: "checkout/pay",
        effect: "irreversible",
        map: { site: "store", pending: "writes are not compiled into ops yet" },
      }),
    );

    const reports = await service.verify(
      { ids: ["checkout/pay"] },
      { env: "prod", as: "readonly" },
    );

    expect(reports[0]?.verified).toBe(false);
    expect(reports[0]?.reason).toMatch(/read-only/);
    expect(service.caseRead("checkout/pay").row.status).toBe("draft");
  });

  it("lists environments with session presence and no path or credential", () => {
    const { service, save, home } = envService(() => new FakeApp("Login"));
    save("prod", "readonly");

    const listed = service.environments();
    const prod = listed.find((item) => item.name === "prod");

    expect(prod).toMatchObject({
      writes: false,
      profiles: [
        { name: "readonly", session: true },
        { name: "admin", session: false },
      ],
    });
    expect(JSON.stringify(listed)).not.toContain(home);
  });
});

describe("QaService map links", () => {
  const maps = join(import.meta.dirname, "../../../maps");

  function service() {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-map-"));
    const config = {
      ...mergeQaConfig(root, { baseUrl: "http://app", database: ":memory:" }),
      maps,
    };
    return new QaService(config, { createSubstrate: (() => new FakeApp("Login")) as never });
  }

  const write = (overrides: Record<string, unknown>) =>
    loginCase({ id: "cart/add", effect: "write", ...overrides });

  it("accepts a write case whose op exists with the same effect", () => {
    const qa = service();
    expect(() =>
      qa.caseWrite(write({ map: { site: "store", version: 1, op: "add_to_cart" } })),
    ).not.toThrow();
  });

  it("refuses an op that does not exist, a read op, and a missing map", () => {
    const qa = service();

    expect(() => qa.caseWrite(write({ map: { site: "store", version: 1, op: "nope" } }))).toThrow(
      /op "nope" is not in store v1/,
    );
    expect(() =>
      qa.caseWrite(write({ map: { site: "store", version: 1, op: "view_cart" } })),
    ).toThrow(/is a read op but the case says effect: write/);
    expect(() => qa.caseWrite(write({ map: { site: "ghost", version: 1, op: "x" } }))).toThrow(
      /map ghost v1 was not found/,
    );
  });

  it("requires confirm on an irreversible op's step", () => {
    const qa = service();
    const checkout = (confirm: boolean) =>
      write({
        id: "cart/checkout",
        effect: "irreversible",
        map: { site: "store", version: 1, op: "checkout" },
        steps: [{ op: "checkout", params: {}, ...(confirm ? { confirm: true } : {}) }],
      });

    expect(() => qa.caseWrite(checkout(false))).toThrow(/needs confirm: true/);
    expect(() => qa.caseWrite(checkout(true))).not.toThrow();
  });

  it("allows an explicit pending link, and reports it from sync", () => {
    const qa = service();
    qa.caseWrite(
      write({ id: "keys/create", map: { site: "store", pending: "writes do not compile yet" } }),
    );

    const report = qa.sync();
    expect(report.pending).toEqual([{ id: "keys/create", reason: "writes do not compile yet" }]);
    expect(report.invalid).toEqual([]);
  });

  it("does not run a case whose link is wrong, and says so", async () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-qa-map-"));
    const base = { ...mergeQaConfig(root, { baseUrl: "http://app", database: ":memory:" }), maps };
    const qa = new QaService(base, { createSubstrate: (() => new FakeApp("Login")) as never });
    qa.caseWrite(write({ map: { site: "store", version: 1, op: "add_to_cart" } }));

    // The file is edited by hand after it was written: the op is renamed away.
    const path = join(base.cases, "cart", "add.json");
    const edited = JSON.parse(readFileSync(path, "utf8"));
    edited.map.op = "renamed_op";
    writeFileSync(path, JSON.stringify(edited));

    const result = await qa.run({ ids: ["cart/add"] }, { allowUnverified: true });
    expect(result.results[0]).toMatchObject({ status: "error", fail_code: "invalid_request" });
    expect(result.results[0]?.fail_reason).toContain('op "renamed_op" is not in store v1');
    expect(result.summary.error).toBe(1);
  });
});
